import { randomUUID } from 'node:crypto';
import process from 'node:process';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { MAX_MONEY_CENTS } from '../../src/common/money';
import { configureApp } from '../../src/configure-app';
import { DatabaseService } from '../../src/database/database.service';
import { AuthRateLimiter } from '../../src/modules/auth/auth-rate-limiter';
import { DepositRateLimiter } from '../../src/modules/wallets/deposit-rate-limiter';
import { WalletsRepository } from '../../src/modules/wallets/wallets.repository';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') {
  throw new Error('Run npm run test:db.');
}

describe('Wallet HTTP and PostgreSQL atomicity', () => {
  let app: NestExpressApplication;
  let db: DatabaseService;
  let user: { id: string; token: string };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
  });
  beforeEach(async () => {
    jest.spyOn(app.get(AuthRateLimiter), 'consume').mockReturnValue(null);
    jest.spyOn(app.get(DepositRateLimiter), 'consume').mockReturnValue(null);
    user = await register();
  });
  afterAll(async () => {
    await app.close();
  });

  async function register() {
    const result = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .set('X-CSRF-Protection', '1')
      .send({ email: `${randomUUID()}@example.test`, password: 'Wallet password 42!' })
      .expect(201);

    return { id: result.body.user.id as string, token: result.body.accessToken as string };
  }

  function deposit(amount: unknown, key: string = randomUUID(), token = user.token) {
    return request(app.getHttpServer())
      .post('/api/v1/wallet/deposits')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ amountCents: amount });
  }

  function wallet(token = user.token) {
    return request(app.getHttpServer())
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${token}`);
  }

  async function assertCounts(entries: number, records = entries) {
    expect(await db.client.walletEntry.count({ where: { userId: user.id } })).toBe(entries);
    expect(await db.client.idempotencyRecord.count({ where: { userId: user.id } })).toBe(records);
  }

  it('returns a private zero wallet and accepts bidder credits with a ledger', async () => {
    const initial = await wallet().expect(200);

    expect(initial.body).toEqual({
      totalCents: 0,
      reservedCents: 0,
      availableCents: 0,
      version: 0,
      serverTime: expect.any(String),
    });

    const result = await deposit(1234).expect(201);

    expect(result.body.wallet).toMatchObject({
      totalCents: 1234,
      reservedCents: 0,
      availableCents: 1234,
      version: 1,
    });

    const entry = await db.client.walletEntry.findUniqueOrThrow({
      where: { id: result.body.depositId },
    });

    expect(entry).toMatchObject({
      userId: user.id,
      reference: result.body.depositId,
      type: 'DEPOSIT',
      totalDeltaCents: 1234n,
      reservedDeltaCents: 0n,
    });
    expect((await wallet().expect(200)).body.totalCents).toBe(1234);
    await assertCounts(1);
  });
  it.each([0, -1, 1.5, MAX_MONEY_CENTS + 1, Number.MAX_SAFE_INTEGER + 1, '100', null, true, {}])(
    'rejects invalid cents %j without writes',
    async (amount) => {
      await deposit(amount).expect(400);
      await assertCounts(0);
      expect((await wallet().expect(200)).body.totalCents).toBe(0);
    },
  );
  it('requires a UUID key and rejects extra user-supplied fields', async () => {
    await deposit(1, 'bad').expect(400);
    await deposit(1).unset('Idempotency-Key').expect(400);
    await deposit(1).send({ userId: randomUUID() }).expect(400);
    await deposit(1).send({ role: 'AUCTIONEER' }).expect(400);
    await assertCounts(0);
  });
  it('requires an active bearer session and enforces current roles', async () => {
    await wallet().unset('Authorization').expect(401);
    await deposit(1).unset('Authorization').expect(401);
    await db.client.user.update({ where: { id: user.id }, data: { role: 'AUCTIONEER' } });
    await wallet().expect(200);
    await deposit(1).expect(403);
    await db.client.authSession.updateMany({
      where: { userId: user.id },
      data: { revokedAt: new Date() },
    });
    await wallet().expect(401);
    await deposit(1).expect(401);
    await assertCounts(0);
  });
  it('cannot read or credit a different user through a path or body', async () => {
    const other = await register();

    await deposit(100).expect(201);
    expect((await wallet(other.token).expect(200)).body.totalCents).toBe(0);
    await request(app.getHttpServer())
      .get(`/api/v1/wallet/${other.id}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(404);
    await deposit(100).send({ userId: other.id }).expect(400);
  });
  it('replays the original result even after later deposits, normalizing UUID case', async () => {
    const key = randomUUID();
    const first = await deposit(123, key).expect(201);

    await deposit(20).expect(201);
    expect((await deposit(123, key.toUpperCase()).expect(201)).body).toEqual(first.body);
    expect((await wallet().expect(200)).body.totalCents).toBe(143);
    await deposit(124, key)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('IDEMPOTENCY_KEY_REUSED'));
    await assertCounts(2);
  });
  it('credits once for concurrent identical requests and returns identical responses', async () => {
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => deposit(101, key).expect(201)),
    );

    for (const response of responses) {
      expect(response.body).toEqual(responses[0]!.body);
    }

    expect((await wallet().expect(200)).body.totalCents).toBe(101);
    await assertCounts(1);
  });
  it('allows only one body for a concurrently reused key', async () => {
    const key = randomUUID();
    const results = await Promise.all([deposit(100, key), deposit(200, key)]);

    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);

    const accepted = results.find((result) => result.status === 201)!;

    expect((await wallet().expect(200)).body.totalCents).toBe(accepted.body.wallet.totalCents);
    await assertCounts(1);
  });
  it('preserves every concurrent credit and existing reservations', async () => {
    await db.client.wallet.update({
      where: { userId: user.id },
      data: { totalCents: 100n, reservedCents: 40n },
    });
    await Promise.all(Array.from({ length: 10 }, () => deposit(23).expect(201)));
    expect((await wallet().expect(200)).body).toMatchObject({
      totalCents: 330,
      reservedCents: 40,
      availableCents: 290,
      version: 10,
    });
    await assertCounts(10);
  });
  it('serializes credits at the maximum balance without partial failed writes', async () => {
    await deposit(MAX_MONEY_CENTS - 10).expect(201);

    const responses = await Promise.all([deposit(10), deposit(10)]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(responses.find((r) => r.status === 422)!.body.code).toBe('BALANCE_LIMIT_EXCEEDED');
    expect((await wallet().expect(200)).body.totalCents).toBe(MAX_MONEY_CENTS);
    await assertCounts(2);
  });
  it('rolls back balance, ledger and idempotency if ledger persistence fails; retry succeeds', async () => {
    const key = randomUUID();
    const spy = jest
      .spyOn(app.get(WalletsRepository), 'recordDeposit')
      .mockRejectedValueOnce(new Error('Injected ledger failure'));

    await deposit(100, key).expect(500);
    expect((await wallet().expect(200)).body).toMatchObject({ totalCents: 0, version: 0 });
    await assertCounts(0);
    spy.mockRestore();
    await deposit(100, key).expect(201);
    await assertCounts(1);
  });
  it('scopes keys to each user and operation, with canonical JSON bodies', async () => {
    const other = await register();
    const key = randomUUID();

    await deposit(100, key).expect(201);
    await deposit(200, key, other.token).expect(201);

    const service = app.get(IdempotencyService);
    const work = jest.fn(async () => ({ status: 200, body: { ok: true } }));

    await service.execute(
      { userId: user.id, operation: 'test:scope', key, request: { b: 2, a: { y: 2, x: 1 } } },
      work,
    );
    await service.execute(
      { userId: user.id, operation: 'test:scope', key, request: { a: { x: 1, y: 2 }, b: 2 } },
      work,
    );
    expect(work).toHaveBeenCalledTimes(1);
    expect((await wallet(other.token).expect(200)).body.totalCents).toBe(200);
    await assertCounts(1, 2);
  });
  it('persists replay data across an application restart', async () => {
    const key = randomUUID();
    const result = await deposit(50, key).expect(201);

    await app.close();

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
    expect((await deposit(50, key).expect(201)).body).toEqual(result.body);
    await assertCounts(1);
  });
  it('limits new operations to five per minute but allows recovery by replay', async () => {
    jest.mocked(app.get(DepositRateLimiter).consume).mockRestore();

    const key = randomUUID();
    const first = await deposit(1, key).expect(201);

    for (let i = 0; i < 4; i++) {
      await deposit(1).expect(201);
    }

    const limited = await deposit(1).expect(429);

    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await deposit(1, key).expect(201)).body).toEqual(first.body);

    const other = await register();

    await deposit(1, randomUUID(), other.token).expect(201);
    await assertCounts(5);
  });
});
