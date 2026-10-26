import process from 'node:process';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AuctionHarness, Account } from '../helpers/auction-harness';
import { SettlementsService } from '../../src/modules/settlements/settlements.service';
import { SettlementsRepository } from '../../src/modules/settlements/settlements.repository';
import { AuctionScheduler } from '../../src/modules/settlements/auction-scheduler';
import { AuctionClock } from '../../src/modules/auctions/auction-clock';
import { AuctionEvents } from '../../src/modules/auctions/auction-events';
import { AuditService } from '../../src/modules/audit/audit.service';
import { AuditAnchorRepository } from '../../src/modules/audit/audit-anchor.repository';
import { WalletsRepository } from '../../src/modules/wallets/wallets.repository';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') throw new Error('Run npm run test:db.');
describe('Atomic settlement, public receipts and recovered deadlines', () => {
  let h: AuctionHarness, a: Account, b: Account;
  beforeEach(async () => { h = new AuctionHarness(); await h.start(); a = await h.account('BIDDER', 10_000); b = await h.account('BIDDER', 10_000); });
  afterEach(async () => { await h.close(); });
  const settle = (id: string) => h.app.get(SettlementsService).settle(id);
  const receipt = (code: string) => request(h.app.getHttpServer()).get(`/api/v1/receipts/${code}`);
  function expire(lot: { endsAt: string }) { h.now = new Date(lot.endsAt); }
  async function wonLot() { const lot = await h.publish(); await h.bid(lot.id, a).expect(201); await h.bid(lot.id, b, 1100).expect(201); return lot; }
  function scheduler() {
    // Keep explicitly started jobs local to this test's seller in the shared disposable database.
    const repo = h.app.get(SettlementsRepository);
    jest.spyOn(repo, 'pendingPage').mockImplementation(after => h.db.client.auction.findMany({ where: { sellerId: h.seller.id,
      lifecycle: { not: 'CANCELLED' }, settlementStatus: { in: ['NOT_DUE', 'PENDING'] }, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: 100, select: { id: true } }));
    jest.spyOn(h.app.get(AuditAnchorRepository), 'pendingPage').mockResolvedValue([]);
    return h.app.get(AuctionScheduler);
  }
  it('debits only the winner, credits the seller and publishes one private-data-free receipt', async () => {
    const lot = await wonLot(); expire(lot); h.source.get.mockRejectedValue(new Error('Provider offline'));
    expect(await settle(lot.id)).toBe('COMPLETED');
    expect(await h.wallet(a)).toMatchObject({ totalCents: 10_000, reservedCents: 0 });
    expect(await h.wallet(b)).toMatchObject({ totalCents: 8900, reservedCents: 0 });
    expect(await h.wallet(h.seller)).toMatchObject({ totalCents: 1100 });
    const settlement = await h.db.client.settlement.findUniqueOrThrow({ where: { auctionId: lot.id } });
    const entries = await h.db.client.walletEntry.findMany({ where: { reference: settlement.id } });
    expect(entries.map(row => row.totalDeltaCents).reduce((sum, value) => sum + value, 0n)).toBe(0n); expect(entries).toHaveLength(2);
    expect(await h.db.client.reservation.findFirst({ where: { auctionId: lot.id, status: 'ACTIVE' } })).toBeNull();
    const saved = await h.db.client.receipt.findUniqueOrThrow({ where: { auctionId: lot.id } });
    const publicResult = await receipt(saved.publicCode).expect(200); expect(publicResult.headers['cache-control']).toBe('no-store');
    expect(publicResult.body).toMatchObject({ title: 'Pikachu', amountCents: 1100, settledAt: h.now.toISOString(), publicCode: saved.publicCode, winnerPseudonym: saved.winnerPseudonym });
    expect(saved.publicCode).toMatch(/^[A-Za-z0-9_-]{32}$/);
    for (const field of ['sellerId', 'bidderId', 'userId', 'email', 'wallet', 'passwordHash', 'itemSnapshot']) expect(publicResult.body).not.toHaveProperty(field);
    for (const id of [a.id, b.id, h.seller.id]) expect(JSON.stringify(publicResult.body)).not.toContain(id);
    const detail = (await h.detail(lot.id).expect(200)).body; expect(detail).toMatchObject({ status: 'ENDED', settlementStatus: 'COMPLETED', outcome: { kind: 'SOLD', amountCents: 1100, receiptCode: saved.publicCode } });
    expect((await h.app.get(AuditService).verify(lot.id)).integrity).toBe('VERIFIED');
    await request(h.app.getHttpServer()).get(publicResult.body.imageUrl).expect(200);
    await receipt('invalid').expect(404); await receipt(randomBytes(24).toString('base64url')).expect(404);
  });
  it('settles a no-bid lot without money movements or a receipt', async () => {
    const lot = await h.publish(); expire(lot); expect(await settle(lot.id)).toBe('COMPLETED');
    const record = await h.db.client.settlement.findUniqueOrThrow({ where: { auctionId: lot.id } });
    expect(record).toMatchObject({ amountCents: 0n, winningBidId: null, status: 'COMPLETED' });
    expect(await h.db.client.walletEntry.count({ where: { reference: record.id } })).toBe(0);
    expect(await h.db.client.receipt.findUnique({ where: { auctionId: lot.id } })).toBeNull();
    expect((await h.detail(lot.id).expect(200)).body.outcome).toEqual({ kind: 'NO_BIDS', amountCents: 0 });
  });
  it('serializes duplicate jobs and retries after a lost commit acknowledgement', async () => {
    const lot = await wonLot(); expire(lot);
    const transaction = h.db.transaction.bind(h.db);
    jest.spyOn(h.db, 'transaction').mockImplementationOnce(async work => { await transaction(work); throw new Error('Lost commit ACK'); });
    expect(await settle(lot.id)).toBe('COMPLETED');
    expect(await Promise.all([settle(lot.id), settle(lot.id), settle(lot.id)])).toEqual(['COMPLETED', 'COMPLETED', 'COMPLETED']);
    expect(await h.wallet(b)).toMatchObject({ totalCents: 8900 }); expect(await h.wallet(h.seller)).toMatchObject({ totalCents: 1100 });
    expect(await h.db.client.receipt.count({ where: { auctionId: lot.id } })).toBe(1);
  });
  it('settles two auctions concurrently while preserving reservations for remaining lots', async () => {
    const lots = [await h.publish(), await h.publish(), await h.publish()];
    for (const lot of lots) await h.bid(lot.id, a).expect(201);
    expire(lots[0]); expect(await Promise.all(lots.slice(0, 2).map(lot => settle(lot.id)))).toEqual(['COMPLETED', 'COMPLETED']);
    expect(await h.wallet(a)).toMatchObject({ totalCents: 8000, reservedCents: 1000, availableCents: 7000 });
    expect(await h.wallet(h.seller)).toMatchObject({ totalCents: 2000 });
  });
  it('ignores cancelled lots and an old job after an extension', async () => {
    const cancelled = await h.publish(); await h.cancel(cancelled.id).expect(200); expire(cancelled); expect(await settle(cancelled.id)).toBe('IGNORED');
    const lot = await h.publish({ endsAt: new Date(h.now.getTime() + 1000).toISOString() });
    const accepted = await h.bid(lot.id, a).expect(201); expire(lot); expect(await settle(lot.id)).toBe('NOT_DUE');
    h.now = new Date(accepted.body.auction.endsAt); expect(await settle(lot.id)).toBe('COMPLETED');
  });
  it.each([-1, 0])('serializes bid versus settlement at %i ms from the original end', async offset => {
    const lot = await h.publish(); h.now = new Date(new Date(lot.endsAt).getTime() + offset);
    const [bid, result] = await Promise.all([h.bid(lot.id, a), settle(lot.id)]);
    expect(bid.status).toBe(offset < 0 ? 201 : 409); expect(result).toBe(offset < 0 ? 'NOT_DUE' : 'COMPLETED');
    const saved = await h.db.client.auction.findUniqueOrThrow({ where: { id: lot.id } }); expect(saved.bidCount).toBe(offset < 0 ? 1 : 0);
  });
  it('rolls back debit and credit when receipt persistence fails, then completes safely on retry', async () => {
    const lot = await wonLot(); expire(lot);
    jest.spyOn(h.app.get(SettlementsRepository), 'receipt').mockRejectedValueOnce(new Error('Storage failure'));
    expect(await settle(lot.id)).toBe('PENDING'); expect(await h.wallet(b)).toMatchObject({ totalCents: 10_000, reservedCents: 1100 });
    expect(await h.wallet(h.seller)).toMatchObject({ totalCents: 0 });
    expect(await h.db.client.walletEntry.count({ where: { userId: b.id, type: 'PURCHASE' } })).toBe(0);
    expect(await h.db.client.receipt.findUnique({ where: { auctionId: lot.id } })).toBeNull();
    expect((await h.detail(lot.id).expect(200)).body).toMatchObject({ status: 'ENDED', settlementStatus: 'PENDING' });
    expect(await settle(lot.id)).toBe('COMPLETED'); expect(await h.wallet(b)).toMatchObject({ totalCents: 8900, reservedCents: 0 });
  });
  it('does not settle a pending audit head and resumes only after reconciliation', async () => {
    const lot = await h.publish(); jest.spyOn(h.app.get(AuditAnchorRepository), 'commit').mockRejectedValueOnce(new Error('Anchor unavailable'));
    const listener = jest.fn(); h.app.get(AuctionEvents).subscribe(listener);
    const pending = await h.bid(lot.id, a).expect(202);
    expect(listener).toHaveBeenCalledWith({ auctionId: lot.id, reason: 'RECHECK' });
    expect(listener).not.toHaveBeenCalledWith({ auctionId: lot.id, reason: 'BID_ACCEPTED' });
    expire(lot); expect(await settle(lot.id)).toBe('PENDING');
    expect(await h.wallet(a)).toMatchObject({ totalCents: 10_000, reservedCents: 1000 });
    expect(await h.app.get(AuditService).reconcile(pending.body.operationId)).toBe('CONFIRMED'); expect(await settle(lot.id)).toBe('COMPLETED');
  });
  it.each(['wallet', 'reservation', 'history', 'seller_limit'])('records permanent %s inconsistency without any partial transfer', async kind => {
    const lot = await wonLot(); expire(lot);
    if (kind === 'wallet') await h.db.client.wallet.update({ where: { userId: b.id }, data: { totalCents: 0n, reservedCents: 0n } });
    if (kind === 'reservation') await h.db.client.reservation.updateMany({ where: { auctionId: lot.id, status: 'ACTIVE' }, data: { amountCents: 1099n } });
    if (kind === 'history') await h.db.client.bid.updateMany({ where: { auctionId: lot.id, sequence: 2 }, data: { amountCents: 1101n } });
    if (kind === 'seller_limit') await h.db.client.wallet.update({ where: { userId: h.seller.id }, data: { totalCents: 100_000_000_000n } });
    expect(await settle(lot.id)).toBe('FAILED'); expect(await settle(lot.id)).toBe('FAILED');
    expect(await h.db.client.walletEntry.count({ where: { userId: b.id, type: 'PURCHASE' } })).toBe(0);
    expect(await h.db.client.walletEntry.count({ where: { userId: h.seller.id, type: 'SALE' } })).toBe(0);
    expect(await h.db.client.receipt.findUnique({ where: { auctionId: lot.id } })).toBeNull();
    expect((await h.detail(lot.id).expect(200)).body).not.toHaveProperty('outcome');
  });
  it('restores expired auctions after restart without an external provider or browser', async () => {
    const lot = await wonLot(); await h.close(); expire(lot); h.source.get.mockRejectedValue(new Error('Provider offline')); await h.boot();
    const jobs = scheduler(); await jobs.start();
    expect((await h.detail(lot.id).expect(200)).body.settlementStatus).toBe('COMPLETED');
    expect(await h.wallet(b)).toMatchObject({ totalCents: 8900 });
    await jobs.reconcile(); expect(await h.wallet(b)).toMatchObject({ totalCents: 8900 });
  });
  it('runs the deadline timer without requests from clients and emits start/end only after commit', async () => {
    const jobs = scheduler(); await jobs.start();
    jest.mocked(h.app.get(AuctionClock).now).mockRestore();
    h.now = new Date(); const events: { reason: string; auctionId: string }[] = [];
    h.app.get(AuctionEvents).subscribe(event => { events.push(event); });
    const lot = await h.publish({ startsAt: new Date(Date.now() + 400).toISOString(), endsAt: new Date(Date.now() + 1000).toISOString() });
    for (let i = 0; i < 40; i++) { const saved = await h.db.client.auction.findUniqueOrThrow({ where: { id: lot.id } }); if (saved.settlementStatus === 'COMPLETED') break; await delay(50); }
    expect((await h.db.client.auction.findUniqueOrThrow({ where: { id: lot.id } })).settlementStatus).toBe('COMPLETED');
    expect(events.filter(event => event.auctionId === lot.id).map(event => event.reason)).toEqual(expect.arrayContaining(['PUBLISHED', 'STARTED', 'ENDED']));
  });
  it('recovers a pending bid before automatically settling its expired auction', async () => {
    const lot = await h.publish(); jest.spyOn(h.app.get(AuditAnchorRepository), 'commit').mockRejectedValueOnce(new Error('Temporary outage'));
    await h.bid(lot.id, a).expect(202); expire(lot); await scheduler().start();
    expect((await h.detail(lot.id).expect(200)).body.settlementStatus).toBe('COMPLETED'); expect(await h.wallet(a)).toMatchObject({ totalCents: 9000, reservedCents: 0 });
  });
  it('does not emit an ended event for a rolled-back transfer or allow a public manual settlement route', async () => {
    const lot = await wonLot(); expire(lot); const listener = jest.fn(); h.app.get(AuctionEvents).subscribe(listener);
    jest.spyOn(h.app.get(WalletsRepository), 'move').mockRejectedValueOnce(new Error('Injected failure')); expect(await settle(lot.id)).toBe('PENDING');
    expect(listener).not.toHaveBeenCalled();
    await request(h.app.getHttpServer()).post(`/api/v1/auctions/${lot.id}/settle`).send({}).expect(404);
  });
});
