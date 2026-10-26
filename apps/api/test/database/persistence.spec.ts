import process from 'node:process';
import { createHash, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Pool, Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DatabaseService } from '../../src/database/database.service';
import { AuditDatabaseService } from '../../src/database/audit-database.service';
import { UsersModule } from '../../src/modules/users/users.module';
import { UsersRepository } from '../../src/modules/users/users.repository';
import { WalletsModule } from '../../src/modules/wallets/wallets.module';
import { WalletsRepository } from '../../src/modules/wallets/wallets.repository';
import { HealthService } from '../../src/modules/health/health.service';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '../../src/config/environment';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') {
  throw new Error('Run npm run test:db to create isolated databases first.');
}

const hash = 'a'.repeat(64);
const mac = 'b'.repeat(64);

describe('PostgreSQL persistence', () => {
  let app: NestExpressApplication;
  let db: DatabaseService;
  let audit: AuditDatabaseService;
  let users: UsersRepository;
  let wallets: WalletsRepository;
  let sql: Pool;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule, UsersModule, WalletsModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
    audit = app.get(AuditDatabaseService);
    users = app.get(UsersRepository);
    wallets = app.get(WalletsRepository);
    sql = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await sql?.end();
    await app?.close();
  });

  async function account(role: 'BIDDER' | 'AUCTIONEER' = 'BIDDER') {
    return db.transaction(async (tx) => {
      const user = await users.create({ email: `${randomUUID()}@example.test`, passwordHash: 'test-only-hash', role }, tx);
      await wallets.create(user.id, tx);
      return user;
    });
  }

  async function lot() {
    const seller = await account('AUCTIONEER');
    const bidder = await account();
    const image = Buffer.from(randomUUID());
    const snapshot = await db.client.catalogSnapshot.create({ data: {
      externalId: 'swsh3-136', language: 'en', title: 'Pikachu', setId: 'swsh3',
      setName: 'Darkness Ablaze', cardNumber: '136', fetchedAt: new Date(),
    } });
    const media = await db.client.mediaAsset.create({ data: {
      bytes: image, mimeType: 'image/png', size: image.length,
      sha256: createHash('sha256').update(image).digest('hex'),
    } });
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + 600_000);
    const auction = await db.client.auction.create({ data: {
      sellerId: seller.id, snapshotId: snapshot.id, imageId: media.id,
      startingPriceCents: 100n, minimumIncrementCents: 10n, startsAt,
      originalEndsAt: endsAt, endsAt, auditHead: hash, auditMac: mac,
    } });
    const bid = await db.client.bid.create({ data: {
      auctionId: auction.id, bidderId: bidder.id, sequence: 1, amountCents: 100n,
      acceptedAt: startsAt, endsAtAfter: endsAt, pseudonym: 'Bidder-123', previousHash: hash, hash, mac,
    } });
    const updatedAuction = await db.client.auction.update({ where: { id: auction.id },
      data: { currentBidId: bid.id, bidCount: 1 } });
    return { auction: updatedAuction, bid, bidder, seller };
  }

  it('persists a user and zero wallet in the same transaction with bigint amounts', async () => {
    const user = await account();
    expect(await users.findByEmail(user.email)).toMatchObject({ id: user.id, role: 'BIDDER' });
    expect(await wallets.findByUserId(user.id)).toEqual({ userId: user.id, totalCents: 0n, reservedCents: 0n, version: 0 });
  });

  it('rolls back every repository write when a later operation fails', async () => {
    const email = `${randomUUID()}@example.test`;
    let userId = '';
    await expect(db.transaction(async (tx) => {
      const user = await users.create({ email, passwordHash: 'test', role: 'BIDDER' }, tx);
      userId = user.id;
      await wallets.create(user.id, tx);
      expect(await wallets.findByUserId(user.id, tx)).not.toBeNull();
      throw new Error('simulated failure');
    })).rejects.toThrow('simulated failure');
    expect(await users.findByEmail(email)).toBeNull();
    expect(await wallets.findByUserId(userId)).toBeNull();
  });

  it('rejects duplicate and non-normalized emails at the database boundary', async () => {
    const user = await account();
    await expect(db.client.user.create({ data: { email: user.email, passwordHash: 'test' } })).rejects.toMatchObject({ code: 'P2002' });
    for (const email of [' Upper@Example.test ', 'UPPER@example.test', '']) {
      await expect(sql.query('INSERT INTO "User" (email, "passwordHash") VALUES ($1, $2)', [email, 'test']))
        .rejects.toMatchObject({ code: '23514', constraint: 'User_email_normalized' });
    }
  });

  it('enforces wallet balance bounds even through direct SQL', async () => {
    const user = await account();
    for (const [total, reserved] of [[-1, 0], [100, -1], [100, 101], [100_000_000_001, 0]]) {
      await expect(sql.query('UPDATE "Wallet" SET "totalCents"=$1, "reservedCents"=$2 WHERE "userId"=$3', [total, reserved, user.id]))
        .rejects.toMatchObject({ code: '23514', constraint: 'Wallet_balances_valid' });
    }
    await db.client.wallet.update({ where: { userId: user.id }, data: { totalCents: 100_000_000_000n, reservedCents: 100_000_000_000n } });
    expect((await wallets.findByUserId(user.id))?.totalCents).toBe(100_000_000_000n);
  });

  it('rolls back a wallet mutation when its ledger insertion violates a constraint', async () => {
    const user = await account();
    await expect(db.transaction(async (tx) => {
      await tx.wallet.update({ where: { userId: user.id }, data: { totalCents: 100n } });
      await tx.walletEntry.create({ data: { userId: user.id, type: 'DEPOSIT', totalDeltaCents: -100n, reservedDeltaCents: 0n, reference: randomUUID() } });
    })).rejects.toBeDefined();
    expect((await wallets.findByUserId(user.id))?.totalCents).toBe(0n);
    expect(await db.client.walletEntry.count({ where: { userId: user.id } })).toBe(0);
  });

  it('allows only one ledger entry per user, operation type and reference', async () => {
    const user = await account();
    const data = { userId: user.id, type: 'SALE' as const, totalDeltaCents: 100n, reservedDeltaCents: 0n, reference: randomUUID() };
    await db.client.walletEntry.create({ data });
    await expect(db.client.walletEntry.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('enforces unique positive bid sequences and valid amounts', async () => {
    const { bid } = await lot();
    const { id: _id, ...data } = bid;
    void _id;
    await expect(db.client.bid.create({ data })).rejects.toMatchObject({ code: 'P2002' });
    for (const [sequence, amount] of [[0, 100], [2, 0], [2, 100_000_000_001]]) {
      await expect(sql.query('UPDATE "Bid" SET sequence=$1, "amountCents"=$2 WHERE id=$3', [sequence, amount, bid.id]))
        .rejects.toMatchObject({ code: '23514', constraint: 'Bid_values_valid' });
    }
  });

  it('permits only one active reservation when two writes race, then permits replacement', async () => {
    const { auction, bid, bidder } = await lot();
    const second = await db.client.bid.create({ data: { ...bid, id: randomUUID(), sequence: 2, amountCents: 110n } });
    const reserve = (bidId: string) => db.client.reservation.create({ data: { auctionId: auction.id, bidId, userId: bidder.id, amountCents: bidId === bid.id ? 100n : 110n } });
    const results = await Promise.allSettled([reserve(bid.id), reserve(second.id)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const active = await db.client.reservation.findFirstOrThrow({ where: { auctionId: auction.id, status: 'ACTIVE' } });
    await db.client.reservation.update({ where: { id: active.id }, data: { status: 'RELEASED' } });
    await reserve(active.bidId === bid.id ? second.id : bid.id);
    expect(await db.client.reservation.count({ where: { auctionId: auction.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('rejects references to bids from another auction or another bidder', async () => {
    const first = await lot();
    const second = await lot();
    await expect(sql.query('UPDATE "Auction" SET "currentBidId"=$1, "bidCount"=1 WHERE id=$2', [second.bid.id, first.auction.id]))
      .rejects.toMatchObject({ code: '23503' });
    await expect(db.client.reservation.create({ data: { auctionId: first.auction.id, bidId: first.bid.id, userId: second.bidder.id, amountCents: 100n } }))
      .rejects.toMatchObject({ code: 'P2003' });
    await expect(db.client.settlement.create({ data: { auctionId: first.auction.id, winningBidId: second.bid.id, amountCents: 100n } }))
      .rejects.toMatchObject({ code: 'P2003' });
  });

  it('enforces one settlement and one receipt per auction', async () => {
    const { auction, bid } = await lot();
    const settlement = { auctionId: auction.id, winningBidId: bid.id, amountCents: 100n };
    await db.client.settlement.create({ data: settlement });
    await expect(db.client.settlement.create({ data: settlement })).rejects.toMatchObject({ code: 'P2002' });
    const receipt = { auctionId: auction.id, publicCode: randomUUID(), itemSnapshot: { title: 'Pikachu' }, amountCents: 100n, winnerPseudonym: 'Bidder-123', finalHash: hash };
    await db.client.receipt.create({ data: receipt });
    await expect(db.client.receipt.create({ data: { ...receipt, publicCode: randomUUID() } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(db.client.auction.delete({ where: { id: auction.id } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects duplicate idempotency keys within the same user and operation', async () => {
    const user = await account();
    const data = { userId: user.id, operation: 'deposit', key: randomUUID(), requestHash: hash };
    await db.client.idempotencyRecord.create({ data });
    await expect(db.client.idempotencyRecord.create({ data })).rejects.toMatchObject({ code: 'P2002' });
    await db.client.idempotencyRecord.create({ data: { ...data, operation: 'bid' } });
  });

  it('rejects invalid auction dates and media metadata through SQL', async () => {
    const { auction } = await lot();
    await expect(sql.query('UPDATE "Auction" SET "endsAt"="startsAt" WHERE id=$1', [auction.id]))
      .rejects.toMatchObject({ code: '23514', constraint: 'Auction_values_valid' });
    await expect(sql.query('UPDATE "MediaAsset" SET size=2097153 WHERE id=$1', [auction.imageId]))
      .rejects.toMatchObject({ code: '23514', constraint: 'MediaAsset_valid' });
    await expect(sql.query('UPDATE "MediaAsset" SET "mimeType"=$1 WHERE id=$2', ['image/svg+xml', auction.imageId]))
      .rejects.toMatchObject({ code: '23514', constraint: 'MediaAsset_valid' });
  });

  it('isolates audit records from main tables and main database credentials', async () => {
    const auctionId = randomUUID();
    await audit.client.auditCheckpoint.create({ data: { auctionId, sequence: 0, headHash: hash, headMac: mac } });
    await expect(sql.query('SELECT * FROM "AuditCheckpoint"')).rejects.toMatchObject({ code: '42P01' });
    const unauthorized = new URL(process.env.DATABASE_URL!);
    unauthorized.pathname = '/holobid_audit';
    const client = new Client({ connectionString: unauthorized.toString(), connectionTimeoutMillis: 2_000 });
    try { await expect(client.connect()).rejects.toMatchObject({ code: '42501' }); }
    finally { await client.end(); }
    expect(await audit.client.auditCheckpoint.findUnique({ where: { auctionId } })).not.toBeNull();
  });

  it('allows only one pending audit intent and preserves resolved history', async () => {
    const data = { auctionId: randomUUID(), operationKey: randomUUID(), nextSequence: 0, nextHeadHash: hash, nextHeadMac: mac };
    const first = await audit.client.auditIntent.create({ data });
    await expect(audit.client.auditIntent.create({ data: { ...data, operationKey: randomUUID() } })).rejects.toMatchObject({ code: 'P2002' });
    await audit.client.auditIntent.update({ where: { id: first.id }, data: { state: 'COMMITTED', resolvedAt: new Date() } });
    await audit.client.auditIntent.create({ data: { ...data, operationKey: randomUUID(), expectedSequence: 0, expectedHeadHash: hash, nextSequence: 1 } });
    expect(await audit.client.auditIntent.count({ where: { auctionId: data.auctionId } })).toBe(2);
  });

  it('reports real dependency availability while liveness never probes the database', async () => {
    const mainPing = jest.spyOn(db, 'ping');
    const auditPing = jest.spyOn(audit, 'ping');
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(mainPing).not.toHaveBeenCalled();
    expect(auditPing).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200, { status: 'ready' });
    expect(mainPing).toHaveBeenCalledTimes(1);
    expect(auditPing).toHaveBeenCalledTimes(1);
  });

  it.each(['main', 'audit'] as const)('returns sanitized 503 for unavailable %s database and recovers', async (dependency) => {
    const unavailable = { DATABASE_URL: 'postgresql://secret:do-not-expose@127.0.0.1:1/missing',
      AUDIT_DATABASE_URL: 'postgresql://secret:do-not-expose@127.0.0.1:1/missing-audit' };
    const config = new ConfigService<ApiEnvironment, true>(unavailable);
    const failedDb = dependency === 'main' ? new DatabaseService(config) : new AuditDatabaseService(config);
    const health = app.get(HealthService);
    const failedHealth = new HealthService(dependency === 'main' ? failedDb as DatabaseService : db,
      dependency === 'audit' ? failedDb as AuditDatabaseService : audit);
    failedHealth.onApplicationBootstrap();
    const readiness = jest.spyOn(health, 'getReadiness').mockImplementation(() => failedHealth.getReadiness());
    try {
      const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
      expect(response.body).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Service is unavailable.', requestId: response.headers['x-request-id'] });
      expect(JSON.stringify(response.body)).not.toMatch(/secret|missing|postgres|127\.0\.0\.1|stack/);
      await request(app.getHttpServer()).get('/api/v1/health/live').expect(200, { status: 'ok' });
    } finally {
      readiness.mockRestore();
      await failedDb.onApplicationShutdown();
    }
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
  });
});
