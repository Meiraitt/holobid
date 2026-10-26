import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { AuctionHarness, Account } from '../helpers/auction-harness';
import { AuditService } from '../../src/modules/audit/audit.service';
import { AuditAnchorRepository } from '../../src/modules/audit/audit-anchor.repository';
import { BidsRepository } from '../../src/modules/bids/bids.repository';
import { BidRateLimiter } from '../../src/modules/bids/bid-rate-limiter';
import { WalletsRepository } from '../../src/modules/wallets/wallets.repository';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') throw new Error('Run npm run test:db.');
describe('HTTP bids, real PostgreSQL reservations and audit protocol', () => {
  let h: AuctionHarness, a: Account, b: Account;
  beforeEach(async () => { h = new AuctionHarness(); await h.start(); a = await h.account('BIDDER', 10_000); b = await h.account('BIDDER', 10_000); });
  afterEach(async () => { await h.close(); });
  const code = (expected: string) => ({ body }: { body: { code: string } }) => expect(body.code).toBe(expected);

  it('accepts exact initial/next minimum, reserves only the leader and records compensating ledger entries', async () => {
    const lot = await h.publish(); const first = await h.bid(lot.id, a).expect(201);
    expect(first.body).toMatchObject({ confirmation: 'CONFIRMED', bid: { amountCents: 1000, sequence: 1 }, wallet: { totalCents: 10_000, reservedCents: 1000, availableCents: 9000 } });
    expect(first.body.bid).not.toHaveProperty('bidderId'); expect(first.body.auction).not.toHaveProperty('sellerId');
    const second = await h.bid(lot.id, b, 1100).expect(201);
    expect(second.body.bid.sequence).toBe(2); expect(await h.wallet(a)).toMatchObject({ totalCents: 10_000, reservedCents: 0, availableCents: 10_000 });
    expect(await h.wallet(b)).toMatchObject({ totalCents: 10_000, reservedCents: 1100 });
    const ledger = await h.db.client.walletEntry.findMany({ where: { reference: second.body.bid.id }, orderBy: { type: 'asc' } });
    expect(ledger).toEqual(expect.arrayContaining([expect.objectContaining({ userId: a.id, type: 'RELEASE', reservedDeltaCents: -1000n, totalDeltaCents: 0n }),
      expect.objectContaining({ userId: b.id, type: 'RESERVE', reservedDeltaCents: 1100n, totalDeltaCents: 0n })]));
    expect((await h.app.get(AuditService).verify(lot.id)).integrity).toBe('VERIFIED');
    await h.bid(lot.id, a, 2000).expect(201); expect(await h.wallet(b)).toMatchObject({ reservedCents: 0 });
  });
  it.each([0, -1, 1.5, '1000', null, 100_000_000_001, Number.MAX_SAFE_INTEGER])('rejects invalid money %j before mutation', async amount => {
    const lot = await h.publish(); await h.bid(lot.id, a, amount).expect(400);
    expect(await h.db.client.bid.count({ where: { auctionId: lot.id } })).toBe(0); expect(await h.wallet(a)).toMatchObject({ reservedCents: 0 });
  });
  it('enforces auth, role, ownership even after role change, UUID and strict payloads', async () => {
    const lot = await h.publish(); await h.bid(lot.id, a).unset('Authorization').expect(401);
    await h.bid(lot.id, h.seller).expect(403); await h.bid(lot.id, a).unset('Idempotency-Key').expect(400);
    await h.bid('invalid', a).expect(400); await h.bid(randomUUID(), a).expect(404);
    await h.bid(lot.id, a).send({ bidderId: b.id }).expect(400);
    await h.db.client.user.update({ where: { id: h.seller.id }, data: { role: 'BIDDER' } }); await h.bid(lot.id, h.seller).expect(403);
  });
  it('rejects minimum, leadership and insufficient funds without history or extensions', async () => {
    const lot = await h.publish({ endsAt: new Date(h.now.getTime() + 90_000).toISOString() });
    await h.bid(lot.id, a, 999).expect(409).expect(({ body }) => expect(body).toMatchObject({ code: 'BID_BELOW_MINIMUM', details: { minimumBidCents: 1000 } }));
    await h.bid(lot.id, a, 10_001).expect(422).expect(code('INSUFFICIENT_FUNDS'));
    expect((await h.detail(lot.id).expect(200)).body.endsAt).toBe(lot.endsAt);
    await h.bid(lot.id, a, 1000).expect(201);
    await h.bid(lot.id, a, 2000).expect(409).expect(code('ALREADY_LEADING'));
    await h.bid(lot.id, b, 1099).expect(409).expect(code('BID_BELOW_MINIMUM'));
    expect(await h.db.client.bid.count({ where: { auctionId: lot.id } })).toBe(1);
  });
  it.each([-1, 0, 1])('enforces exact end boundary at offset %i ms', async offset => {
    const lot = await h.publish(); h.now = new Date(new Date(lot.endsAt).getTime() + offset);
    await h.bid(lot.id, a).expect(offset < 0 ? 201 : 409);
    expect(await h.db.client.bid.count({ where: { auctionId: lot.id } })).toBe(offset < 0 ? 1 : 0);
  });
  it('rejects scheduled/cancelled lots and accepts the exact start', async () => {
    const lot = await h.publish({ startsAt: new Date(h.now.getTime() + 1000).toISOString() });
    await h.bid(lot.id, a).expect(409).expect(code('AUCTION_NOT_STARTED')); h.now = new Date(lot.startsAt); await h.bid(lot.id, a).expect(201);
    const cancelled = await h.publish(); await h.cancel(cancelled.id).expect(200); await h.bid(cancelled.id, a).expect(409).expect(code('AUCTION_CANCELLED'));
  });
  it.each([120_001, 120_000, 90_000, 1000])('extends to acceptedAt + 2 minutes with %i ms remaining', async remaining => {
    const lot = await h.publish({ endsAt: new Date(h.now.getTime() + remaining).toISOString() });
    const first = await h.bid(lot.id, a).expect(201);
    expect(first.body.auction.endsAt).toBe(new Date(h.now.getTime() + Math.max(remaining, 120_000)).toISOString());
    if (remaining < 120_000) {
      h.now = new Date(h.now.getTime() + 60_000); const second = await h.bid(lot.id, b, 1100).expect(201);
      expect(second.body.auction.endsAt).toBe(new Date(h.now.getTime() + 120_000).toISOString());
    }
  });
  it('rechecks time after waiting for a real wallet lock', async () => {
    const lot = await h.publish(); let unlock!: () => void, held!: () => void, requested!: () => void;
    const ready = new Promise<void>(r => { held = r; }), gate = new Promise<void>(r => { unlock = r; }), waiting = new Promise<void>(r => { requested = r; });
    const wallets = h.app.get(WalletsRepository), original = wallets.lock.bind(wallets);
    const holder = h.db.transaction(async tx => { await original(a.id, tx); held(); await gate; }); await ready;
    jest.spyOn(wallets, 'lock').mockImplementation((id, tx) => { requested(); return original(id, tx); });
    const attempted = h.bid(lot.id, a).then(r => r); await waiting; h.now = new Date(lot.endsAt); unlock(); await holder;
    expect((await attempted).body.code).toBe('AUCTION_ENDED'); expect(await h.wallet(a)).toMatchObject({ reservedCents: 0 });
  });
  it('serializes same-value bids: exactly one succeeds', async () => {
    const lot = await h.publish(); const results = await Promise.all([h.bid(lot.id, a), h.bid(lot.id, b)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]); expect(results.find(r => r.status === 409)!.body.code).toBe('BID_BELOW_MINIMUM');
    expect(await h.db.client.reservation.count({ where: { auctionId: lot.id, status: 'ACTIVE' } })).toBe(1);
  });
  it('never overspends one wallet across two simultaneous auctions', async () => {
    const x = await h.publish(), y = await h.publish(); const results = await Promise.all([h.bid(x.id, a, 6000), h.bid(y.id, a, 6000)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 422]); expect(await h.wallet(a)).toMatchObject({ reservedCents: 6000, availableCents: 4000 });
  });
  it('reserves the exact available amount and releases only the outbid lot', async () => {
    const x = await h.publish(), y = await h.publish(); await h.bid(x.id, a, 6000).expect(201); await h.bid(y.id, a, 4000).expect(201);
    expect(await h.wallet(a)).toMatchObject({ reservedCents: 10_000, availableCents: 0 });
    await h.bid(x.id, b, 6100).expect(201); expect(await h.wallet(a)).toMatchObject({ reservedCents: 4000, availableCents: 6000 });
  });
  it('uses ordered wallet locks when two leaders outbid each other across lots', async () => {
    const x = await h.publish(), y = await h.publish(); await h.bid(x.id, a).expect(201); await h.bid(y.id, b).expect(201);
    const results = await Promise.all([h.bid(x.id, b, 1100), h.bid(y.id, a, 1100)]); expect(results.map(r => r.status)).toEqual([201, 201]);
    for (const user of [a, b]) expect(await h.wallet(user)).toMatchObject({ reservedCents: 1100 });
  });
  it('serializes cancellation against a first bid', async () => {
    const lot = await h.publish(); const [bid, cancel] = await Promise.all([h.bid(lot.id, a), h.cancel(lot.id)]);
    expect([bid.status, cancel.status]).toEqual(bid.status === 201 ? [201, 409] : [409, 200]);
    const saved = await h.db.client.auction.findUniqueOrThrow({ where: { id: lot.id } });
    expect(saved.bidCount).toBe(saved.lifecycle === 'CANCELLED' ? 0 : 1);
  });
  it('deduplicates concurrent retries, scopes keys by user/lot and rejects changed bodies', async () => {
    const lot = await h.publish(), key = randomUUID(); const results = await Promise.all([h.bid(lot.id, a, 1000, key), h.bid(lot.id, a, 1000, key)]);
    for (const result of results) expect([201, 202]).toContain(result.status);
    const confirmed = await h.bid(lot.id, a, 1000, key.toUpperCase()).expect(201); await h.bid(lot.id, a, 1100, key).expect(409).expect(code('IDEMPOTENCY_KEY_REUSED'));
    expect(await h.db.client.bid.count({ where: { auctionId: lot.id } })).toBe(1);
    await h.bid(lot.id, b, 1100, key).expect(201); const other = await h.publish(); await h.bid(other.id, a, 1000, key).expect(201);
    h.now = new Date(Date.now() + 86400_000); expect((await h.bid(lot.id, a, 1000, key).expect(201)).body).toEqual(confirmed.body);
  });
  it('returns a conflict, never a unique-index error, for different concurrent bodies sharing a key', async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const lot = await h.publish(), key = randomUUID();
      const results = await Promise.all([h.bid(lot.id, a, 1000, key), h.bid(lot.id, a, 1100, key)]);
      expect(results.map(result => result.status).sort()).toEqual([201, 409]);
      expect(results.find(result => result.status === 409)!.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    }
  });
  it('rolls back release, reserve, ledger and bid when persistence or anchor preparation fails', async () => {
    const lot = await h.publish(); await h.bid(lot.id, a).expect(201);
    const accept = h.app.get(BidsRepository).accept.bind(h.app.get(BidsRepository));
    jest.spyOn(h.app.get(BidsRepository), 'accept').mockImplementationOnce(async (bid, tx) => { await accept(bid, tx); throw new Error('Injected failure'); });
    await h.bid(lot.id, b, 1100).expect(500);
    jest.spyOn(h.app.get(AuditAnchorRepository), 'prepare').mockRejectedValueOnce(new Error('Anchor offline')); await h.bid(lot.id, b, 1100).expect(503);
    expect(await h.wallet(a)).toMatchObject({ reservedCents: 1000 }); expect(await h.wallet(b)).toMatchObject({ reservedCents: 0 });
    expect(await h.db.client.bid.count({ where: { auctionId: lot.id } })).toBe(1);
    expect(await h.db.client.walletEntry.count({ where: { userId: b.id, type: 'RESERVE' } })).toBe(0);
  });
  it('keeps confirmation pending after commit failure and recovers on identical retry after restart', async () => {
    const lot = await h.publish(), key = randomUUID(); jest.spyOn(h.app.get(AuditAnchorRepository), 'commit').mockRejectedValueOnce(new Error('Lost anchor ACK'));
    const result = await h.bid(lot.id, a, 1000, key).expect(202); expect(result.body).toEqual({ confirmation: 'PENDING', auctionId: lot.id, operationId: expect.any(String) });
    expect(await h.wallet(a)).toMatchObject({ reservedCents: 1000 }); await h.bid(lot.id, b, 1100).expect(409).expect(code('AUDIT_PENDING'));
    await h.deposit(a, 100).expect(201); await h.close(); await h.boot();
    await h.bid(lot.id, a, 1000, key).expect(201); expect((await h.app.get(AuditService).verify(lot.id)).integrity).toBe('VERIFIED');
  });
  it('keeps an uncertain absent commit pending and forbids changed requests', async () => {
    const lot = await h.publish(), key = randomUUID(), transaction = h.db.transaction.bind(h.db);
    jest.spyOn(h.db, 'transaction').mockImplementationOnce(work => transaction(async tx => { await work(tx); throw new Error('Commit outcome unknown'); }));
    await h.bid(lot.id, a, 1000, key).expect(202); await h.bid(lot.id, a, 1000, key).expect(202);
    await h.bid(lot.id, a, 1100, key).expect(409).expect(code('IDEMPOTENCY_KEY_REUSED')); expect(await h.wallet(a)).toMatchObject({ reservedCents: 0 });
    expect(await h.db.client.bid.count({ where: { auctionId: lot.id } })).toBe(0);
  });
  it('rejects tampered history and inconsistent reservation balances', async () => {
    const lot = await h.publish(); await h.db.client.auction.update({ where: { id: lot.id }, data: { startingPriceCents: 1234n } });
    await h.bid(lot.id, a, 1300).expect(409).expect(code('AUDIT_TAMPERED'));
    const valid = await h.publish(); await h.db.client.wallet.update({ where: { userId: a.id }, data: { reservedCents: 1n } });
    await h.bid(valid.id, a).expect(409).expect(code('WALLET_INCONSISTENT'));
  });
  it('supports the maximum valid amount and reports exhaustion without overflow', async () => {
    const rich = await h.account('BIDDER', 100_000_000_000), lot = await h.publish();
    const accepted = await h.bid(lot.id, rich, 100_000_000_000).expect(201); expect(accepted.body.auction.minimumNextBidCents).toBeNull();
    await h.bid(lot.id, a).expect(409).expect(code('BID_LIMIT_REACHED'));
  });
  it('limits new attempts but lets a successful operation replay', async () => {
    jest.mocked(h.app.get(BidRateLimiter).consume).mockRestore(); const lot = await h.publish(), key = randomUUID();
    await h.bid(lot.id, a, 1000, key).expect(201); for (let i = 0; i < 9; i++) await h.bid(lot.id, a, 1100).expect(409);
    await h.bid(lot.id, a, 1100).expect(429); await h.bid(lot.id, a, 1000, key).expect(201);
  });
});
