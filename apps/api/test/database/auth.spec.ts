import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DatabaseService } from '../../src/database/database.service';
import { WalletsRepository } from '../../src/modules/wallets/wallets.repository';
import { AuthRateLimiter } from '../../src/modules/auth/auth-rate-limiter';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') throw new Error('Run npm run test:db.');
const password = 'Correct password 42!';
const email = () => `${randomUUID()}@example.test`;

describe('Password authentication', () => {
  let app: NestExpressApplication;
  let db: DatabaseService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
  });
  beforeEach(() => { jest.spyOn(app.get(AuthRateLimiter), 'consume').mockReturnValue(null); });
  afterAll(async () => { await app.close(); });

  function post(path: string, body: unknown) {
    return request(app.getHttpServer()).post(`/api/v1/auth/${path}`).set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send(body as object);
  }

  it('registers only a bidder with a zero wallet and an explicitly serialized response', async () => {
    const address = email();
    const result = await post('register', { email: `  ${address.toUpperCase()}  `, password }).expect(201);
    expect(Object.keys(result.body).sort()).toEqual(['accessToken', 'expiresIn', 'user']);
    expect(Object.keys(result.body.user).sort()).toEqual(['email', 'id', 'role']);
    expect(result.body.user).toMatchObject({ email: address, role: 'BIDDER' });
    expect(result.body.expiresIn).toBe(900);
    const stored = await db.client.user.findUniqueOrThrow({ where: { email: address }, include: { wallet: true } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    expect(stored.passwordHash.split('$')[3]?.split(',').sort()).toEqual(['m=19456', 'p=1', 't=2']);
    expect(await argon2.verify(stored.passwordHash, password)).toBe(true);
    expect(stored.wallet).toMatchObject({ totalCents: 0n, reservedCents: 0n });
    expect(JSON.stringify(result.body)).not.toContain(stored.passwordHash);
    const claims = app.get(JwtService).decode(result.body.accessToken);
    expect(claims).toMatchObject({ sub: stored.id, role: 'BIDDER', iss: 'holobid-api', aud: 'holobid-web' });
    expect(claims.exp - claims.iat).toBe(900);
    expect(claims).not.toHaveProperty('email');
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${result.body.accessToken}`)
      .expect(200, result.body.user);
  });

  it('uses a fresh salt for identical passwords and preserves spaces in passwords', async () => {
    const first = email(), second = email();
    await post('register', { email: first, password: ` ${password} ` }).expect(201);
    await post('register', { email: second, password: ` ${password} ` }).expect(201);
    const a = await db.client.user.findUniqueOrThrow({ where: { email: first } });
    const b = await db.client.user.findUniqueOrThrow({ where: { email: second } });
    expect(a.passwordHash).not.toBe(b.passwordHash);
    await post('login', { email: first, password }).expect(401);
    await post('login', { email: first, password: ` ${password} ` }).expect(200);
  });

  it('handles concurrent duplicate registration atomically', async () => {
    const address = email();
    const results = await Promise.all([post('register', { email: address, password }), post('register', { email: address.toUpperCase(), password })]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(results.find(r => r.status === 409)?.body.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(await db.client.user.count({ where: { email: address } })).toBe(1);
    const user = await db.client.user.findUniqueOrThrow({ where: { email: address } });
    expect(await db.client.wallet.count({ where: { userId: user.id } })).toBe(1);
  });

  it('rolls back registration when wallet creation fails', async () => {
    const address = email();
    jest.spyOn(app.get(WalletsRepository), 'create').mockRejectedValueOnce(new Error('private database failure'));
    await post('register', { email: address, password }).expect(500);
    expect(await db.client.user.findUnique({ where: { email: address } })).toBeNull();
  });

  it('rejects role injection and malformed credentials before persistence', async () => {
    const address = email();
    const bodies = [
      { email: address, password, role: 'AUCTIONEER' },
      { email: address, password: 'short' }, { email: address, password: 'x'.repeat(129) },
      { email: 'not-email', password }, { email: address, password: 1234567890 },
      { email: { value: address }, password }, {},
    ];
    for (const body of bodies) {
      const result = await post('register', body).expect(400);
      expect(result.body.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(result.body)).not.toContain(password);
    }
    expect(await db.client.user.findUnique({ where: { email: address } })).toBeNull();
  });

  it('uses the same public error for an unknown email and an incorrect password', async () => {
    const address = email();
    await post('register', { email: address, password }).expect(201);
    const unknown = await post('login', { email: email(), password }).expect(401);
    const wrong = await post('login', { email: address, password: 'Incorrect password!' }).expect(401);
    for (const result of [unknown, wrong]) {
      expect(result.body).toEqual({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.', requestId: result.headers['x-request-id'] });
    }
    const login = await post('login', { email: address.toUpperCase(), password }).expect(200);
    expect(login.body.user.email).toBe(address);
  });

  it('allows a persisted auctioneer to log in without allowing public role selection', async () => {
    const address = email();
    await post('register', { email: address, password }).expect(201);
    await db.client.user.update({ where: { email: address }, data: { role: 'AUCTIONEER' } });
    const result = await post('login', { email: address, password }).expect(200);
    expect(result.body.user.role).toBe('AUCTIONEER');
  });

  it('rejects missing, modified, expired and incorrectly scoped access tokens', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    const result = await post('register', { email: email(), password }).expect(201);
    const jwt = app.get(JwtService);
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: result.body.user.id, sid: jwt.decode(result.body.accessToken).sid, role: 'BIDDER', iat: now, exp: now + 900 };
    const options = { secret: Buffer.from(process.env.JWT_SECRET!, 'base64url'), algorithm: 'HS256' as const, issuer: 'holobid-api', audience: 'holobid-web' };
    const tokens = [
      'invalid-token', result.body.accessToken + 'broken',
      jwt.sign({ ...claims, iat: now - 901, exp: now - 1 }, options),
      jwt.sign(claims, { ...options, audience: 'other-app' }),
      jwt.sign(claims, { ...options, issuer: 'other-api' }),
      jwt.sign(claims, { ...options, algorithm: 'HS384' }),
      jwt.sign({ ...claims, role: 'ADMIN' }, options),
      jwt.sign({ sub: claims.sub, role: 'BIDDER' }, options),
    ];
    for (const token of tokens) {
      await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    }
  });

  it('never logs passwords or tokens during successful or failed authentication', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const address = email();
    const result = await post('register', { email: address, password }).expect(201);
    await post('login', { email: address, password: 'incorrect-secret!' }).expect(401);
    const output = JSON.stringify([log.mock.calls, error.mock.calls]);
    for (const secret of [address, password, 'incorrect-secret!', result.body.accessToken]) expect(output).not.toContain(secret);
  });

  it('limits login attempts and does not trust spoofed forwarding headers', async () => {
    jest.mocked(app.get(AuthRateLimiter).consume).mockRestore();
    const address = email();
    for (let i = 0; i < 5; i++) await post('login', { email: address, password }).expect(401);
    const blocked = await post('login', { email: address.toUpperCase(), password }).set('X-Forwarded-For', '203.0.113.4').expect(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});
