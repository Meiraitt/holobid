import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AuctionHarness } from '../helpers/auction-harness';
import { DemoService } from '../../src/modules/demo/demo.service';
import { DemoRotation } from '../../src/modules/demo/demo-rotation.service';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, demoId, demoWindow } from '../../src/modules/demo/demo.constants';
import { PasswordService } from '../../src/modules/auth/password.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { AuditAnchorRepository } from '../../src/modules/audit/audit-anchor.repository';
import { SettlementsService } from '../../src/modules/settlements/settlements.service';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') throw new Error('Run npm run test:db.');
describe('Repeatable offline demo data and delayed evaluation', () => {
  let h: AuctionHarness;
  const baseTime = new Date('2026-10-26T12:00:00Z'), lateTime = new Date('2026-11-05T12:00:00Z');
  // Only this runner-created disposable database is touched; remove this suite's fixed fixtures.
  async function cleanDemo() {
    const users = await h.db.client.user.findMany({ where: { OR: [{ id: { in: DEMO_ACCOUNTS.map(row => row.id) } }, { email: { in: DEMO_ACCOUNTS.map(row => row.email) } }] } });
    const ids = users.map(user => user.id);
    const lots = await h.db.client.auction.findMany({ where: { OR: [{ sellerId: { in: ids } }, { isDemo: true }] }, select: { id: true } });
    const lotIds = lots.map(lot => lot.id);
    await h.db.transaction(async tx => {
      await tx.receipt.deleteMany({ where: { auctionId: { in: lotIds } } }); await tx.settlement.deleteMany({ where: { auctionId: { in: lotIds } } });
      await tx.reservation.deleteMany({ where: { auctionId: { in: lotIds } } });
      await tx.auction.updateMany({ where: { id: { in: lotIds } }, data: { currentBidId: null, bidCount: 0 } });
      await tx.bid.deleteMany({ where: { auctionId: { in: lotIds } } }); await tx.auction.deleteMany({ where: { id: { in: lotIds } } });
      await tx.idempotencyRecord.deleteMany({ where: { userId: { in: ids } } }); await tx.walletEntry.deleteMany({ where: { userId: { in: ids } } });
      await tx.authSession.deleteMany({ where: { userId: { in: ids } } }); await tx.wallet.deleteMany({ where: { userId: { in: ids } } }); await tx.user.deleteMany({ where: { id: { in: ids } } });
    });
    const auditIds = [...lotIds, demoId('ended'), demoId('scheduled'), demoWindow(baseTime).id, demoWindow(lateTime).id,
      demoWindow(new Date('2026-10-27T00:00:00Z')).id, demoWindow(new Date('2026-11-06T00:00:00Z')).id];
    await h.auditDb.client.auditIntent.deleteMany({ where: { auctionId: { in: auditIds } } }); await h.auditDb.client.auditCheckpoint.deleteMany({ where: { auctionId: { in: auditIds } } });
  }
  beforeEach(async () => { h = new AuctionHarness(); h.now = new Date(baseTime); await h.start(); await cleanDemo(); h.app.get(ConfigService).set('DEMO_MODE', true); h.source.get.mockRejectedValue(new Error('TCGdex offline')); });
  afterEach(async () => { h.app.get(ConfigService).set('DEMO_MODE', false); await h.close(); });
  const seed = () => h.app.get(DemoService).seed();
  async function login(index: number) {
    const account = DEMO_ACCOUNTS[index]!;
    const response = await request(h.app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1')
      .send({ email: account.email, password: DEMO_PASSWORD }).expect(200);
    return { id: account.id, token: response.body.accessToken as string };
  }
  it('seeds three usable Argon2 accounts, real local images and live/scheduled/ended lots offline', async () => {
    const result = await seed(); expect(result.auctionId).toBe(demoWindow(baseTime).id);
    const lots = await h.db.client.auction.findMany({ where: { sellerId: DEMO_ACCOUNTS[0].id } }); expect(lots).toHaveLength(3);
    for (const [i, account] of DEMO_ACCOUNTS.entries()) {
      const stored = await h.db.client.user.findUniqueOrThrow({ where: { id: account.id } });
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/); expect(await h.app.get(PasswordService).verify(DEMO_PASSWORD, stored.passwordHash)).toBe(true);
      expect((await h.wallet(await login(i))).totalCents).toBe(Number(account.balance));
    }
    const states: string[] = [];
    for (const lot of lots) {
      const detail = (await h.detail(lot.id).expect(200)).body; states.push(detail.status);
      expect(detail.auditIntegrity).toBe('VERIFIED'); await request(h.app.getHttpServer()).get(detail.imageUrl).expect(200);
    }
    expect(states.sort()).toEqual(['ENDED', 'LIVE', 'SCHEDULED']);
    expect((await h.detail(demoId('ended')).expect(200)).body.outcome).toEqual({ kind: 'NO_BIDS', amountCents: 0 });
    expect(h.source.get).not.toHaveBeenCalled();
  });
  it('repeating seed preserves password changes, balances, reservations and accepted history', async () => {
    const result = await seed(), bidder = await login(1); await h.bid(result.auctionId, bidder).expect(201); await h.deposit(bidder, 500).expect(201);
    const changedHash = await h.app.get(PasswordService).hash('Changed demo password 123!');
    await h.db.client.user.update({ where: { id: bidder.id }, data: { passwordHash: changedHash } });
    const wallet = await h.wallet(bidder), bids = await h.db.client.bid.findMany({ where: { auctionId: result.auctionId } });
    const counts = { lots: await h.db.client.auction.count({ where: { sellerId: DEMO_ACCOUNTS[0].id } }), entries: await h.db.client.walletEntry.count({ where: { userId: bidder.id } }) };
    await seed(); await seed();
    expect(await h.wallet(bidder)).toMatchObject({ totalCents: wallet.totalCents, availableCents: wallet.availableCents, reservedCents: wallet.reservedCents, version: wallet.version }); expect(await h.db.client.bid.findMany({ where: { auctionId: result.auctionId } })).toEqual(bids);
    expect((await h.db.client.user.findUniqueOrThrow({ where: { id: bidder.id } })).passwordHash).toBe(changedHash);
    expect(await h.db.client.auction.count({ where: { sellerId: DEMO_ACCOUNTS[0].id } })).toBe(counts.lots);
    expect(await h.db.client.walletEntry.count({ where: { userId: bidder.id } })).toBe(counts.entries);
  });
  it('concurrent seeds converge on one account set and one open daily demo auction', async () => {
    const results = await Promise.allSettled([seed(), seed(), seed()]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(new Set(results.flatMap(result => result.status === 'fulfilled' ? [result.value.auctionId] : [])).size).toBe(1);
    expect(await h.db.client.auction.count({ where: { sellerId: DEMO_ACCOUNTS[0].id } })).toBe(3);
    expect(await h.db.client.auction.count({ where: { isDemo: true, lifecycle: 'OPEN' } })).toBe(1);
    expect(await h.db.client.walletEntry.count({ where: { userId: { in: DEMO_ACCOUNTS.map(row => row.id) }, type: 'DEPOSIT' } })).toBe(2);
  });
  it('does not take over an existing account with a demo email', async () => {
    const regular = await h.account(); await h.db.client.user.update({ where: { id: regular.id }, data: { email: DEMO_ACCOUNTS[0].email } });
    const before = await h.db.client.user.findUnique({ where: { id: regular.id } });
    await expect(seed()).rejects.toThrow('collision');
    expect(await h.db.client.user.findUnique({ where: { id: regular.id } })).toEqual(before);
    expect(await h.db.client.user.count({ where: { id: { in: DEMO_ACCOUNTS.map(row => row.id) } } })).toBe(0);
  });
  it('requires DEMO_MODE and keeps disabled startup free of demo writes', async () => {
    h.app.get(ConfigService).set('DEMO_MODE', false);
    await expect(seed()).rejects.toThrow('DEMO_MODE'); await h.app.get(DemoRotation).start();
    expect(await h.db.client.user.count({ where: { id: { in: DEMO_ACCOUNTS.map(row => row.id) } } })).toBe(0);
  });
  it('recovers on November 5 with a new live lot, preserved history and no synthetic bids', async () => {
    const initial = await seed(), bidder = await login(1); await h.bid(initial.auctionId, bidder).expect(201);
    const previous = await h.db.client.auction.findUniqueOrThrow({ where: { id: initial.auctionId } });
    h.now = new Date(lateTime); await h.close(); await h.boot(); h.app.get(ConfigService).set('DEMO_MODE', true);
    await h.app.get(DemoRotation).start();
    const fresh = await h.db.client.auction.findUniqueOrThrow({ where: { id: demoWindow(lateTime).id } });
    expect(fresh.id).not.toBe(previous.id); expect(fresh.snapshotId).toBe(previous.snapshotId); expect(fresh.imageId).toBe(previous.imageId);
    expect((await h.detail(fresh.id).expect(200)).body).toMatchObject({ status: 'LIVE', auditIntegrity: 'VERIFIED', bidCount: 0 });
    expect((await h.detail(previous.id).expect(200)).body).toMatchObject({ settlementStatus: 'COMPLETED', outcome: { kind: 'SOLD', amountCents: 1000 } });
    expect(await h.db.client.auction.count({ where: { isDemo: true } })).toBe(2); // No backfill of missed days.
    expect((await h.wallet(await login(1))).totalCents).toBe(49_000); expect((await h.wallet(await login(0))).totalCents).toBe(1000);
    expect(await h.db.client.bid.count({ where: { auctionId: { in: [previous.id, fresh.id] } } })).toBe(1);
    expect((await h.app.get(AuditService).verify(previous.id)).integrity).toBe('VERIFIED');
  });
  it('cancellation cannot generate multiple lots in the same daily window', async () => {
    const initial = await seed(), owner = await login(0);
    await request(h.app.getHttpServer()).post(`/api/v1/auctions/${initial.auctionId}/cancel`).set('Authorization', `Bearer ${owner.token}`).set('Idempotency-Key', demoId('cancel-key')).send({}).expect(200);
    await h.app.get(DemoService).rotate(); await seed();
    expect(await h.db.client.auction.count({ where: { isDemo: true } })).toBe(1);
    h.now = new Date('2026-10-27T00:00:00Z'); const next = await h.app.get(DemoService).rotate(); expect(next.auctionId).not.toBe(initial.auctionId);
    expect(await h.db.client.auction.count({ where: { isDemo: true, lifecycle: 'OPEN' } })).toBe(1);
  });
  it('respects anti-sniping past midnight before rotating into the next window', async () => {
    const initial = await seed(); h.now = new Date('2026-10-26T23:59:30Z'); await h.bid(initial.auctionId, await login(1)).expect(201);
    h.now = new Date('2026-10-27T00:00:00Z'); expect((await h.app.get(DemoService).rotate()).auctionId).toBe(initial.auctionId);
    h.now = new Date('2026-10-27T00:01:30Z'); const next = await h.app.get(DemoService).rotate(); expect(next.auctionId).toBe(demoWindow(h.now).id);
    expect((await h.detail(initial.auctionId).expect(200)).body.settlementStatus).toBe('COMPLETED');
  });
  it('resumes a partially seeded audit operation without resetting accounts or duplicating lots', async () => {
    const anchor = h.app.get(AuditAnchorRepository), failure = jest.spyOn(anchor, 'commit').mockRejectedValue(new Error('offline'));
    await expect(seed()).rejects.toMatchObject({ code: 'DEMO_AUDIT_PENDING' });
    const before = await h.db.client.wallet.findMany({ where: { userId: { in: DEMO_ACCOUNTS.map(row => row.id) } }, orderBy: { userId: 'asc' } });
    failure.mockRestore(); await seed();
    expect(await h.db.client.wallet.findMany({ where: { userId: { in: DEMO_ACCOUNTS.map(row => row.id) } }, orderBy: { userId: 'asc' } })).toEqual(before);
    expect(await h.db.client.auction.count({ where: { sellerId: DEMO_ACCOUNTS[0].id } })).toBe(3);
  });
  it('retains an uncertain missing main commit instead of recreating its daily slot', async () => {
    const initial = await seed(); h.now = new Date(lateTime); await h.app.get(SettlementsService).settle(initial.auctionId);
    const transaction = h.db.transaction.bind(h.db);
    jest.spyOn(h.db, 'transaction').mockImplementationOnce(work => transaction(async tx => { await work(tx); throw new Error('Unknown commit acknowledgement'); }));
    await expect(h.app.get(DemoService).rotate()).rejects.toMatchObject({ code: 'DEMO_AUDIT_PENDING' });
    await expect(h.app.get(DemoService).rotate()).rejects.toMatchObject({ code: 'DEMO_AUDIT_PENDING' });
    expect(await h.db.client.auction.findUnique({ where: { id: demoWindow(lateTime).id } })).toBeNull();
    expect(await h.auditDb.client.auditIntent.count({ where: { auctionId: demoWindow(lateTime).id, state: 'PREPARED' } })).toBe(1);
  });
  it('blocks rotation on an inconsistent previous audit instead of hiding the failure', async () => {
    const initial = await seed(); await h.db.client.auction.update({ where: { id: initial.auctionId }, data: { minimumIncrementCents: 101n } });
    h.now = new Date(lateTime); await expect(h.app.get(DemoService).rotate()).rejects.toThrow('confirmation');
    expect(await h.db.client.auction.count({ where: { isDemo: true } })).toBe(1);
  });
  it('keeps rotation blocked after a failed settlement has already marked the old lot ENDED', async () => {
    const initial = await seed(), bidder = await login(1); await h.bid(initial.auctionId, bidder).expect(201);
    await h.db.client.wallet.update({ where: { userId: bidder.id }, data: { reservedCents: 0n } });
    h.now = new Date(lateTime);
    for (let attempt = 0; attempt < 2; attempt++) await expect(h.app.get(DemoService).rotate()).rejects.toThrow('confirmation');
    expect(await h.db.client.auction.count({ where: { isDemo: true } })).toBe(1);
    expect(await h.db.client.auction.findUnique({ where: { id: initial.auctionId } })).toMatchObject({ lifecycle: 'ENDED', settlementStatus: 'FAILED' });
  });
  it('runs the compiled seed twice without starting a background server or resetting wallets', async () => {
    const cli = join(__dirname, '../../dist/cli/demo-seed.js');
    const run = (enabled: string) => spawnSync(process.execPath, [cli], { env: { ...process.env, DEMO_MODE: enabled }, encoding: 'utf8', timeout: 12_000 });
    expect(run('false').status).toBe(1);
    const first = run('true'); expect(first.status).toBe(0); expect(JSON.parse(first.stdout).status).toBe('ready');
    const wallets = await h.db.client.wallet.findMany({ where: { userId: { in: DEMO_ACCOUNTS.map(row => row.id) } }, orderBy: { userId: 'asc' } });
    const second = run('true'); expect(second.status).toBe(0); expect(JSON.parse(second.stdout).auctionId).toBe(JSON.parse(first.stdout).auctionId);
    expect(await h.db.client.wallet.findMany({ where: { userId: { in: DEMO_ACCOUNTS.map(row => row.id) } }, orderBy: { userId: 'asc' } })).toEqual(wallets);
  });
});
