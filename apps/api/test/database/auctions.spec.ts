import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { CreateAuctionInput } from '@holobid/contracts';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DatabaseService } from '../../src/database/database.service';
import { AuditDatabaseService } from '../../src/database/audit-database.service';
import { AuthRateLimiter } from '../../src/modules/auth/auth-rate-limiter';
import { AuctionPublishLimiter } from '../../src/modules/auctions/auction-publish-limiter';
import { AuctionClock } from '../../src/modules/auctions/auction-clock';
import { CatalogHttpService } from '../../src/modules/catalog/catalog-http.service';
import { CatalogImportService } from '../../src/modules/catalog/catalog-import.service';
import { AuditAnchorRepository } from '../../src/modules/audit/audit-anchor.repository';
import { AuditService } from '../../src/modules/audit/audit.service';
import { AuditCrypto } from '../../src/modules/audit/audit-crypto.service';
import { SourceError } from '../../src/modules/catalog/catalog.errors';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') throw new Error('Run npm run test:db.');
const fixturePath = join(__dirname, '../../fixtures/tcgdex');
const card = JSON.parse(readFileSync(join(fixturePath, 'base1-58.json'), 'utf8'));
const image = readFileSync(join(fixturePath, 'base1-58.webp'));
const origin = 'http://localhost:5173';

describe('Auction publication, public listings and cancellation', () => {
  let app: NestExpressApplication, db: DatabaseService, auditDb: AuditDatabaseService;
  let seller: { id: string; token: string }, now: Date;
  let source: { get: jest.Mock };
  async function boot() {
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CatalogHttpService).useValue(source).compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false }); configureApp(app); await app.init(); await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService); auditDb = app.get(AuditDatabaseService);
    jest.spyOn(app.get(AuthRateLimiter), 'consume').mockReturnValue(null);
    jest.spyOn(app.get(AuctionPublishLimiter), 'consume').mockReturnValue(null);
    jest.spyOn(app.get(AuctionClock), 'now').mockImplementation(() => new Date(now));
  }
  beforeEach(async () => {
    now = new Date();
    source = { get: jest.fn(async (_url: string, kind: string) => kind === 'image' ? { bytes: image, mimeType: 'image/webp' }
      : { bytes: Buffer.from(JSON.stringify(card)), mimeType: 'application/json' }) };
    await boot(); seller = await account('AUCTIONEER');
  });
  afterEach(async () => { await app.close(); });
  async function account(role: 'BIDDER' | 'AUCTIONEER') {
    const result = await request(app.getHttpServer()).post('/api/v1/auth/register').set('Origin', origin).set('X-CSRF-Protection', '1')
      .send({ email: `${randomUUID()}@example.test`, password: 'Auction password 42!' }).expect(201);
    await db.client.user.update({ where: { id: result.body.user.id }, data: { role } });
    return { id: result.body.user.id as string, token: result.body.accessToken as string };
  }
  function input(overrides: Partial<CreateAuctionInput> = {}): CreateAuctionInput {
    return { externalItemId: card.id, startingPriceCents: 1000, minimumIncrementCents: 100,
      startsAt: new Date(now.getTime() - 1000).toISOString(), endsAt: new Date(now.getTime() + 600_000).toISOString(), ...overrides };
  }
  function publish(body: object = input(), key: string = randomUUID(), token = seller.token) {
    return request(app.getHttpServer()).post('/api/v1/auctions').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send(body);
  }
  function cancel(id: string, key: string = randomUUID(), token = seller.token) {
    return request(app.getHttpServer()).post(`/api/v1/auctions/${id}/cancel`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send({});
  }
  function detail(id: string) { return request(app.getHttpServer()).get(`/api/v1/auctions/${id}`); }
  function list(query: object = {}) { return request(app.getHttpServer()).get('/api/v1/auctions').query(query); }

  it('publishes from server-fetched card data, persists genesis and exposes only public fields', async () => {
    const result = await publish().expect(201);
    expect(result.body).toMatchObject({ title: 'Pikachu', status: 'LIVE', bidCount: 0, currentBidCents: null, startingPriceCents: 1000,
      minimumNextBidCents: 1000, minimumIncrementCents: 100, confirmation: 'CONFIRMED', auditIntegrity: 'VERIFIED', canReceiveBids: true });
    expect(result.body.imageUrl).toMatch(/^\/api\/v1\/media\//); expect(result.headers['cache-control']).toBe('no-store');
    expect(await app.get(AuditService).verify(result.body.id)).toMatchObject({ integrity: 'VERIFIED', expectedCount: 0 });
    expect(await auditDb.client.auditCheckpoint.findUnique({ where: { auctionId: result.body.id } })).not.toBeNull();
    const exposed = (await detail(result.body.id).expect(200)).body;
    for (const field of ['sellerId', 'bidderId', 'email', 'passwordHash', 'wallet', 'snapshotId', 'imageId', 'auditMac']) expect(exposed).not.toHaveProperty(field);
    expect(JSON.stringify(exposed)).not.toContain('assets.tcgdex.net');
    source.get.mockRejectedValue(new Error('Provider offline'));
    await detail(result.body.id).expect(200); await request(app.getHttpServer()).get(result.body.imageUrl).expect(200);
  });
  it.each([{ startingPriceCents: 0 }, { startingPriceCents: -1 }, { startingPriceCents: 1.2 }, { startingPriceCents: '100' },
    { startingPriceCents: 100_000_000_001 }, { minimumIncrementCents: 0 }, { minimumIncrementCents: 1.5 },
    { externalItemId: 'https://evil.example/item' }, { sellerId: 'forged' }, { title: 'Forged' }, { imageUrl: 'https://evil.example' },
    { startsAt: '2030-W01-1T12:00:00Z' }, { startsAt: '2030-001T12:00:00Z' }, { endsAt: '20300101T120000Z' },
    { startsAt: '2030-02-30T12:00:00Z' }, { startsAt: '2030-01-01T12:00:00' }, { endsAt: 'invalid' }])('rejects invalid publication %j before external access', async fields => {
    await publish({ ...input(), ...fields }).expect(400); expect(source.get).not.toHaveBeenCalled();
    expect(await db.client.auction.count({ where: { sellerId: seller.id } })).toBe(0);
  });
  it('normalizes timezone offsets and replays equivalent UTC timestamps', async () => {
    const key = randomUUID(), body = input();
    const withOffset = (date: string) => new Date(new Date(date).getTime() + 3 * 3_600_000).toISOString().replace('Z', '+03:00');
    const created = await publish({ ...body, startsAt: withOffset(body.startsAt), endsAt: withOffset(body.endsAt) }, key).expect(201);
    expect(created.body.startsAt).toBe(body.startsAt); expect(created.body.endsAt).toBe(body.endsAt);
    expect((await publish(body, key).expect(201)).body).toEqual(created.body);
  });
  it('rejects reversed, equal or expired dates and rechecks time after external I/O', async () => {
    await publish(input({ endsAt: new Date(now.getTime() - 2000).toISOString() })).expect(400);
    await publish(input({ startsAt: now.toISOString(), endsAt: now.toISOString() })).expect(400);
    const body = input(); const prepare = app.get(CatalogImportService).prepare.bind(app.get(CatalogImportService));
    jest.spyOn(app.get(CatalogImportService), 'prepare').mockImplementationOnce(async id => { const result = await prepare(id); now = new Date(body.endsAt); return result; });
    await publish(body).expect(400); expect(await db.client.auction.count({ where: { sellerId: seller.id } })).toBe(0);
  });
  it('requires authentication, auctioneer role and a valid idempotency key', async () => {
    await publish().unset('Authorization').expect(401);
    const bidder = await account('BIDDER'); await publish(input(), randomUUID(), bidder.token).expect(403);
    await publish(input(), 'invalid').expect(400); await publish().unset('Idempotency-Key').expect(400);
    expect(source.get).not.toHaveBeenCalled();
  });
  it('replays creation after provider outage and expiration without downloading or duplicating', async () => {
    const key = randomUUID(), body = input(); const original = await publish(body, key).expect(201);
    source.get.mockClear().mockRejectedValue(new Error('Provider offline')); now = new Date(new Date(body.endsAt).getTime() + 1);
    expect((await publish(body, key.toUpperCase()).expect(201)).body).toEqual(original.body);
    await publish({ ...body, startingPriceCents: 1200 }, key).expect(409);
    expect(source.get).not.toHaveBeenCalled(); expect(await db.client.auction.count({ where: { sellerId: seller.id } })).toBe(1);
  });
  it('serializes duplicate concurrent publications and rejects conflicting bodies', async () => {
    const key = randomUUID(), body = input();
    const results = await Promise.all(Array.from({ length: 4 }, () => publish(body, key)));
    for (const result of results) expect([201, 202]).toContain(result.status);
    const confirmed = await publish(body, key).expect(201);
    const ids = results.map(result => result.body.id ?? result.body.auctionId); expect(new Set([...ids, confirmed.body.id]).size).toBe(1);
    expect(await db.client.auction.count({ where: { sellerId: seller.id } })).toBe(1);
    for (let attempt = 0; attempt < 12; attempt++) {
      const conflictKey = randomUUID(); const conflict = await Promise.all([publish(body, conflictKey), publish({ ...body, startingPriceCents: 1234 }, conflictKey)]);
      expect(conflict.map(result => result.status).sort()).toEqual([201, 409]);
    }
  });
  it('keeps same keys independent across auctioneers', async () => {
    const other = await account('AUCTIONEER'), key = randomUUID(), body = input();
    const one = await publish(body, key).expect(201); const two = await publish(body, key, other.token).expect(201); expect(one.body.id).not.toBe(two.body.id);
  });
  it('does not persist incomplete lots if the source, CDN or anchor preparation fails', async () => {
    source.get.mockRejectedValueOnce(new SourceError(false, 404)); await publish().expect(404);
    source.get.mockImplementationOnce(async () => ({ bytes: Buffer.from(JSON.stringify(card)), mimeType: 'application/json' })).mockRejectedValueOnce(new SourceError(true, 503));
    await publish().expect(503);
    jest.spyOn(app.get(AuditAnchorRepository), 'prepare').mockRejectedValueOnce(new Error('Anchor offline'));
    await publish().expect(503);
    expect(await db.client.auction.count({ where: { sellerId: seller.id } })).toBe(0);
    expect(await db.client.idempotencyRecord.count({ where: { userId: seller.id, operation: 'POST /auctions' } })).toBe(0);
  });
  it('returns 202 and recovers the same operation after process-context restart', async () => {
    const key = randomUUID(), body = input();
    jest.spyOn(app.get(AuditAnchorRepository), 'commit').mockRejectedValueOnce(new Error('Confirmation unavailable'));
    const pending = await publish(body, key).expect(202);
    expect(pending.body).toEqual({ confirmation: 'PENDING', auctionId: expect.any(String), operationId: expect.any(String) });
    expect((await detail(pending.body.auctionId).expect(200)).body).toMatchObject({ confirmation: 'PENDING', canReceiveBids: false });
    await cancel(pending.body.auctionId).expect(409).expect(({ body }) => expect(body.code).toBe('AUDIT_PENDING'));
    await app.close(); await boot(); source.get.mockClear().mockRejectedValue(new Error('Provider offline'));
    const recovered = await publish(body, key).expect(201); expect(recovered.body.id).toBe(pending.body.auctionId); expect(source.get).not.toHaveBeenCalled();
    expect(await db.client.auction.count({ where: { sellerId: seller.id } })).toBe(1);
  });
  it('does not recreate an uncertain missing primary operation and rejects a changed retry', async () => {
    const key = randomUUID(), body = input(), transaction = db.transaction.bind(db);
    jest.spyOn(db, 'transaction').mockImplementationOnce(work => transaction(async tx => { await work(tx); throw new Error('Commit outcome unknown'); }));
    const pending = await publish(body, key).expect(202); expect(await db.client.auction.count({ where: { sellerId: seller.id } })).toBe(0);
    source.get.mockClear().mockRejectedValue(new Error('Provider offline'));
    expect((await publish(body, key).expect(202)).body).toEqual(pending.body);
    await publish({ ...body, startingPriceCents: 1200 }, key).expect(409); expect(source.get).not.toHaveBeenCalled();
    expect((await app.get(AuditAnchorRepository).findOperation(pending.body.operationId))!.state).toBe('PREPARED');
  });
  it('derives scheduled/live/ended at exact boundaries and keeps settlement separate', async () => {
    const body = input({ startsAt: new Date(now.getTime() + 10_000).toISOString() }); const created = await publish(body).expect(201);
    expect(created.body.status).toBe('SCHEDULED'); expect(created.body.canReceiveBids).toBe(false);
    now = new Date(body.startsAt); expect((await detail(created.body.id).expect(200)).body.status).toBe('LIVE');
    now = new Date(body.endsAt); const ended = await detail(created.body.id).expect(200);
    expect(ended.body).toMatchObject({ status: 'ENDED', canReceiveBids: false, settlementStatus: 'NOT_DUE' }); expect(ended.body).not.toHaveProperty('outcome');
    await cancel(created.body.id).expect(409).expect(({ body }) => expect(body.code).toBe('AUCTION_ENDED'));
  });
  it('paginates stable timestamps without duplicates and validates filter-bound cursors', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await publish(input({ startsAt: new Date(now.getTime() + 1000).toISOString() })).expect(201)).body.id);
    await db.client.auction.updateMany({ where: { id: { in: ids } }, data: { createdAt: new Date('2100-01-01T00:00:00Z') } });
    const first = await list({ status: 'SCHEDULED', limit: 2 }).expect(200); expect(first.body.items).toHaveLength(2); expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await list({ status: 'SCHEDULED', limit: 2, cursor: first.body.nextCursor }).expect(200);
    const retrieved = [...first.body.items, ...second.body.items].map((item: { id: string }) => item.id);
    expect(new Set(retrieved).size).toBe(4); expect(retrieved.sort()).toEqual(ids.sort());
    await list({ status: 'LIVE', cursor: first.body.nextCursor }).expect(400);
    for (const query of [{ status: 'CANCELLED' }, { limit: 101 }, { limit: 0 }, { limit: '1e2' }, { cursor: 'garbage' }, { sellerId: seller.id }]) await list(query).expect(400);
    now = new Date('2200-01-01T00:00:00Z'); expect((await list({ status: 'SCHEDULED' }).expect(200)).body).toMatchObject({ items: [], nextCursor: null });
  });
  it('soft-cancels only the owner lot, hides it publicly and preserves media and audit', async () => {
    const created = await publish().expect(201), id = created.body.id, key = randomUUID();
    const other = await account('AUCTIONEER'), bidder = await account('BIDDER');
    await cancel(id, randomUUID(), other.token).expect(404); await cancel(id, randomUUID(), bidder.token).expect(403); await cancel(id).unset('Authorization').expect(401);
    await cancel(randomUUID()).expect(404); await cancel(id).send({ sellerId: seller.id }).expect(400); await cancel(id).unset('Idempotency-Key').expect(400);
    const cancelled = await cancel(id, key).expect(200); expect(cancelled.body).toMatchObject({ status: 'CANCELLED', canCancel: false, canReceiveBids: false, version: 1 });
    expect((await cancel(id, key).expect(200)).body).toEqual(cancelled.body);
    expect((await cancel(id).expect(200)).body.version).toBe(1);
    await detail(id).expect(404);
    for (const status of [undefined, 'SCHEDULED', 'LIVE', 'ENDED']) {
      const page = await list(status ? { status, limit: 100 } : { limit: 100 }).expect(200); expect(page.body.items.map((item: { id: string }) => item.id)).not.toContain(id);
    }
    expect((await app.get(AuditService).verify(id)).integrity).toBe('VERIFIED'); await request(app.getHttpServer()).get(created.body.imageUrl).expect(200);
    expect(await db.client.auction.findUnique({ where: { id } })).not.toBeNull();
    await request(app.getHttpServer()).delete(`/api/v1/auctions/${id}`).expect(404); await request(app.getHttpServer()).patch(`/api/v1/auctions/${id}`).send({}).expect(404);
  });
  it('serializes simultaneous cancellations and a replay of publication without reopening the lot', async () => {
    const key = randomUUID(), body = input(), created = await publish(body, key).expect(201);
    const results = await Promise.all([cancel(created.body.id), cancel(created.body.id), publish(body, key)]);
    expect(results.map(result => result.status)).toEqual([200, 200, 201]);
    expect(await db.client.auction.findUnique({ where: { id: created.body.id } })).toMatchObject({ lifecycle: 'CANCELLED', version: 1 });
  });
  it('refuses cancellation with any stored bid, even if the cached count is falsified', async () => {
    const created = await publish().expect(201), id = created.body.id;
    const bidder = await account('BIDDER'), auction = await db.client.auction.findUniqueOrThrow({ where: { id } });
    const bid = { id: randomUUID(), auctionId: id, bidderId: bidder.id, sequence: 1, amountCents: 1000n,
      acceptedAt: now, endsAtAfter: auction.endsAt, previousHash: auction.auditHead };
    await db.client.bid.create({ data: { ...bid, ...app.get(AuditCrypto).bid(bid) } });
    await cancel(id).expect(409).expect(({ body }) => expect(body.code).toBe('AUCTION_HAS_BIDS'));
    expect((await db.client.auction.findUniqueOrThrow({ where: { id } })).lifecycle).toBe('OPEN');
  });
  it('does not cancel a tampered genesis and never labels it eligible for bidding', async () => {
    const created = await publish().expect(201); await db.client.auction.update({ where: { id: created.body.id }, data: { startingPriceCents: 1234n } });
    await cancel(created.body.id).expect(409).expect(({ body }) => expect(body.code).toBe('AUDIT_TAMPERED'));
    expect((await detail(created.body.id).expect(200)).body).toMatchObject({ auditIntegrity: 'TAMPERED', canReceiveBids: false });
  });
  it('limits new publications but permits successful replay', async () => {
    jest.mocked(app.get(AuctionPublishLimiter).consume).mockRestore();
    const key = randomUUID(), body = input(), first = await publish(body, key).expect(201);
    for (let i = 0; i < 4; i++) await publish().expect(201);
    const limited = await publish().expect(429); expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await publish(body, key).expect(201)).body).toEqual(first.body);
  });
});
