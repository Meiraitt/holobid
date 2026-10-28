import { randomUUID } from 'node:crypto';
import process from 'node:process';

import { Client } from 'pg';
import request from 'supertest';

import { AccountsRepository } from '../../src/modules/accounts/accounts.repository';
import { AuditService } from '../../src/modules/audit/audit.service';
import { AuditAnchorRepository } from '../../src/modules/audit/audit-anchor.repository';
import { AuditSourceRepository } from '../../src/modules/audit/audit-source.repository';
import { SettlementsService } from '../../src/modules/settlements/settlements.service';
import { Account, AuctionHarness } from '../helpers/auction-harness';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') {
  throw new Error('Run npm run test:db.');
}

describe('Bidder and auctioneer dashboard HTTP API', () => {
  let h: AuctionHarness;
  let a: Account;
  let b: Account;

  beforeEach(async () => {
    h = new AuctionHarness();
    await h.start();
    a = await h.account('BIDDER', 100_000);
    b = await h.account('BIDDER', 100_000);
  });
  afterEach(() => h.close());

  function get(path: string, user?: Account) {
    const response = request(h.app.getHttpServer()).get(`/api/v1/${path}`);

    return user ? response.set('Authorization', `Bearer ${user.token}`) : response;
  }

  const mine = (id: string, user = a) => get(`auctions/${id}/me`, user);
  const list = (user = a, query = '') => get(`me/participations${query}`, user);
  const owned = (query = '', user = h.seller) => get(`auctioneer/auctions${query}`, user);
  const summary = (user = h.seller) => get('auctioneer/summary', user);

  async function finish(lot: { id: string; endsAt: string }) {
    h.now = new Date(lot.endsAt);
    expect(await h.app.get(SettlementsService).settle(lot.id)).toBe('COMPLETED');
  }

  it('returns neutral own state, empty lists and zero seller totals for new users', async () => {
    const lot = await h.publish();
    const result = (await mine(lot.id).expect(200)).body;

    expect(result).toMatchObject({
      auctionId: lot.id,
      rank: null,
      highestBidCents: null,
      isLeading: false,
      hasParticipated: false,
      reservedForThisAuctionCents: 0,
      receiptCode: null,
      state: 'NOT_PARTICIPATING',
    });
    expect(result.myPseudonym).toMatch(/^[a-f0-9]{16}$/);
    expect((await list().expect(200)).body).toMatchObject({ items: [], nextCursor: null });
    expect((await summary().expect(200)).body).toMatchObject({
      totalReceivedCents: 0,
      settledCount: 0,
      withoutWinnerCount: 0,
      wallet: { totalCents: 0, reservedCents: 0 },
    });
  });
  it('ranks each bidder once by their highest bid and releases the outbid reservation', async () => {
    const lot = await h.publish();

    await h.bid(lot.id, a, 1000).expect(201);
    await h.bid(lot.id, b, 1100).expect(201);
    await h.bid(lot.id, a, 1200).expect(201);

    const aa = (await mine(lot.id).expect(200)).body;
    const bb = (await mine(lot.id, b).expect(200)).body;

    expect(aa).toMatchObject({
      rank: 1,
      highestBidCents: 1200,
      state: 'LEADING',
      reservedForThisAuctionCents: 1200,
      isLeading: true,
    });
    expect(bb).toMatchObject({
      rank: 2,
      highestBidCents: 1100,
      state: 'OUTBID',
      reservedForThisAuctionCents: 0,
      isLeading: false,
    });

    const bids = (await get(`auctions/${lot.id}/bids`).expect(200)).body.items;

    expect(aa.myPseudonym).toBe(bids[0].bidderPseudonym);
    expect(aa.myPseudonym).toBe(bids[2].bidderPseudonym);
    expect((await list(a, '?filter=active').expect(200)).body.items).toHaveLength(1);

    const other = await h.publish();

    expect((await mine(other.id).expect(200)).body.myPseudonym).not.toBe(aa.myPseudonym);

    const text = JSON.stringify((await list().expect(200)).body);

    for (const value of [a.id, b.id, h.seller.id, a.token, b.token]) {
      expect(text).not.toContain(value);
    }

    for (const field of ['email', 'bidderId', 'userId', 'sellerId', 'mac', 'passwordHash']) {
      expect(text).not.toContain(`"${field}"`);
    }
  });
  it('exposes processing before settlement, then own winner receipt and loser result', async () => {
    const lot = await h.publish();

    await h.bid(lot.id, a).expect(201);
    await h.bid(lot.id, b, 1100).expect(201);
    h.now = new Date(lot.endsAt);
    expect((await mine(lot.id, b).expect(200)).body).toMatchObject({
      state: 'PROCESSING',
      receiptCode: null,
      reservedForThisAuctionCents: 1100,
    });
    expect((await list(b, '?filter=active').expect(200)).body.items).toEqual([]);
    expect((await list(b, '?filter=won').expect(200)).body.items).toEqual([]);
    await finish(lot);

    const winner = (await mine(lot.id, b).expect(200)).body;

    expect(winner).toMatchObject({
      state: 'WON',
      rank: 1,
      reservedForThisAuctionCents: 0,
      settlementStatus: 'COMPLETED',
    });
    expect(winner.receiptCode).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((await mine(lot.id).expect(200)).body).toMatchObject({
      state: 'LOST',
      rank: 2,
      receiptCode: null,
      reservedForThisAuctionCents: 0,
    });
    expect((await list(b, '?filter=won').expect(200)).body.items[0]).toMatchObject({
      auctionId: lot.id,
      receiptCode: winner.receiptCode,
      state: 'WON',
    });
    expect((await list(a, '?filter=won').expect(200)).body.items).toEqual([]);
    await get(`receipts/${winner.receiptCode}`).expect(200);
  });
  it.each(['PENDING', 'FAILED'] as const)(
    'does not call a %s settlement a win or expose a receipt',
    async (status) => {
      const lot = await h.publish();

      await h.bid(lot.id, a).expect(201);
      h.now = new Date(lot.endsAt);
      await h.db.client.auction.update({
        where: { id: lot.id },
        data: { settlementStatus: status },
      });
      expect((await mine(lot.id).expect(200)).body).toMatchObject({
        state: 'PROCESSING',
        settlementStatus: status,
        receiptCode: null,
      });
      expect((await list(a, '?filter=won').expect(200)).body.items).toEqual([]);
      expect((await summary().expect(200)).body).toMatchObject({
        totalReceivedCents: 0,
        settledCount: 0,
      });
    },
  );
  it('paginates distinct participations, scopes cursors to the user/filter and rejects forged cursors', async () => {
    for (let i = 0; i < 3; i++) {
      const lot = await h.publish();

      await h.bid(lot.id, a).expect(201);
    }

    const first = (await list(a, '?limit=2').expect(200)).body;

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();

    const added = await h.publish();

    await h.bid(added.id, a).expect(201);

    const last = (
      await list(a, `?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`).expect(200)
    ).body;

    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...last.items].map((item: { auctionId: string }) => item.auctionId))
        .size,
    ).toBe(3);
    await list(b, `?cursor=${first.nextCursor}`).expect(400);
    await list(a, `?filter=active&cursor=${first.nextCursor}`).expect(400);
    await list(a, `?cursor=x${first.nextCursor}`).expect(400);
    await owned(`?cursor=${first.nextCursor}`).expect(400);
  });
  it('orders tied creation timestamps by UUID and continues without duplicates', async () => {
    const lots = [];

    for (let i = 0; i < 3; i++) {
      const lot = await h.publish();

      await h.bid(lot.id, a).expect(201);
      lots.push(lot.id as string);
    }

    await h.db.client.auction.updateMany({
      where: { id: { in: lots } },
      data: { createdAt: h.now },
    });

    const ids: string[] = [];
    let cursor: string | null = null;

    do {
      const result: request.Response = await list(
        a,
        `?limit=1${cursor ? `&cursor=${cursor}` : ''}`,
      ).expect(200);

      ids.push(result.body.items[0].auctionId);
      cursor = result.body.nextCursor;
    } while (cursor);

    expect(ids).toEqual([...lots].sort().reverse());
  });
  it('restricts owner listings, includes cancelled auctions and computes cancellation reasons', async () => {
    const live = await h.publish();
    const cancelled = await h.publish();
    const withBids = await h.publish();
    const scheduled = await h.publish({
      startsAt: new Date(h.now.getTime() + 60_000).toISOString(),
    });

    await h.cancel(cancelled.id).expect(200);
    await h.bid(withBids.id, a).expect(201);

    const all = (await owned().expect(200)).body.items;

    expect(all).toHaveLength(4);
    expect(all.find((lot: { id: string }) => lot.id === live.id)).toMatchObject({
      canCancel: true,
      cancelReason: null,
    });
    expect(all.find((lot: { id: string }) => lot.id === withBids.id)).toMatchObject({
      canCancel: false,
      cancelReason: 'AUCTION_HAS_BIDS',
    });
    expect((await owned('?status=CANCELLED').expect(200)).body.items).toMatchObject([
      { id: cancelled.id, canCancel: false, cancelReason: 'AUCTION_CANCELLED' },
    ]);
    expect((await owned('?status=SCHEDULED').expect(200)).body.items).toMatchObject([
      { id: scheduled.id },
    ]);
    expect((await owned('?status=LIVE').expect(200)).body.items).toHaveLength(2);

    const other = await h.account('AUCTIONEER');

    expect((await owned('', other).expect(200)).body.items).toEqual([]);
    await mine(cancelled.id).expect(404);
    await mine(randomUUID()).expect(404);
    await mine('invalid').expect(400);
    expect(JSON.stringify(all)).not.toContain(h.seller.id);
    expect(JSON.stringify(all)).not.toContain(a.id);
  });
  it('paginates owner listings with cursors bound to seller and status', async () => {
    for (let i = 0; i < 3; i++) {
      await h.publish();
    }

    const first = (await owned('?limit=2').expect(200)).body;
    const last = (await owned(`?limit=2&cursor=${first.nextCursor}`).expect(200)).body;

    expect(first.items).toHaveLength(2);
    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...last.items].map((item: { id: string }) => item.id)).size,
    ).toBe(3);
    await owned(`?status=LIVE&cursor=${first.nextCursor}`).expect(400);
    await owned(`?cursor=${first.nextCursor}`, await h.account('AUCTIONEER')).expect(400);
  });
  it('sums only completed sales and reconciles seller totals with the SALE ledger', async () => {
    const sold = await h.publish();
    const noBids = await h.publish();
    const cancelled = await h.publish();

    await h.bid(sold.id, a).expect(201);
    await h.cancel(cancelled.id).expect(200);

    const stillLive = await h.publish({
      endsAt: new Date(h.now.getTime() + 3_600_000).toISOString(),
    });

    await h.bid(stillLive.id, b, 2000).expect(201);
    await finish(sold);
    await finish(noBids);

    const totals = (await summary().expect(200)).body;

    expect(totals).toMatchObject({
      totalReceivedCents: 1000,
      settledCount: 1,
      withoutWinnerCount: 1,
      wallet: { totalCents: 1000 },
    });

    const ledger = await h.db.client.walletEntry.aggregate({
      where: { userId: h.seller.id, type: 'SALE' },
      _sum: { totalDeltaCents: true },
    });

    expect(totals.totalReceivedCents).toBe(Number(ledger._sum.totalDeltaCents));

    const ended = (await owned('?status=ENDED').expect(200)).body.items;

    expect(ended).toHaveLength(2);
    expect(ended.find((lot: { id: string }) => lot.id === sold.id)).toMatchObject({
      outcome: { kind: 'SOLD', amountCents: 1000 },
      cancelReason: 'AUCTION_ENDED',
    });
    expect(ended.find((lot: { id: string }) => lot.id === noBids.id)).toMatchObject({
      outcome: { kind: 'NO_BIDS', amountCents: 0 },
    });
    expect((await summary(await h.account('AUCTIONEER')).expect(200)).body.totalReceivedCents).toBe(
      0,
    );
  });
  it('never mixes pre-settlement totals with the post-settlement wallet', async () => {
    const lot = await h.publish();

    await h.bid(lot.id, a).expect(201);
    h.now = new Date(lot.endsAt);

    const repo = h.app.get(AccountsRepository);
    const original = repo.completedSales.bind(repo);

    jest.spyOn(repo, 'completedSales').mockImplementationOnce(async (id, tx) => {
      const result = await original(id, tx);

      await finish(lot);

      return result;
    });
    expect((await summary().expect(200)).body).toMatchObject({
      totalReceivedCents: 0,
      wallet: { totalCents: 0 },
    });
    expect((await summary().expect(200)).body).toMatchObject({
      totalReceivedCents: 1000,
      wallet: { totalCents: 1000 },
    });
  });
  it('keeps own ranking and reservation consistent across a concurrent overbid', async () => {
    const lot = await h.publish();

    await h.bid(lot.id, a).expect(201);

    const repo = h.app.get(AccountsRepository);
    const original = repo.auction.bind(repo);

    jest.spyOn(repo, 'auction').mockImplementationOnce(async (id, tx) => {
      const result = await original(id, tx);

      await h.bid(lot.id, b, 1100).expect(201);

      return result;
    });
    expect((await mine(lot.id).expect(200)).body).toMatchObject({
      rank: 1,
      isLeading: true,
      reservedForThisAuctionCents: 1000,
    });
    expect((await mine(lot.id).expect(200)).body).toMatchObject({
      rank: 2,
      isLeading: false,
      reservedForThisAuctionCents: 0,
    });
  });
  it('reads an owner page while a bid waits for the row without a lock-order deadlock', async () => {
    const lot = await h.publish();
    const audit = h.app.get(AuditService);
    const source = h.app.get(AuditSourceRepository);
    const read = audit.readLockedSnapshots.bind(audit);
    const lock = source.lock.bind(source);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let bidding: Promise<request.Response> | undefined;

    jest.spyOn(source, 'lock').mockImplementationOnce(async (id, tx) => {
      entered();
      await lock(id, tx);
    });
    jest.spyOn(audit, 'readLockedSnapshots').mockImplementationOnce(async (id, tx) => {
      bidding = h
        .bid(lot.id, a)
        .expect(201)
        .then((response) => response);
      await started;

      return read(id, tx);
    });

    const page = await owned().expect(200);

    expect(page.body.items[0]).toMatchObject({ bidCount: 0, auditIntegrity: 'VERIFIED' });
    await bidding;
    expect((await owned().expect(200)).body.items[0]).toMatchObject({
      bidCount: 1,
      auditIntegrity: 'VERIFIED',
    });
  });
  it('disables cancellation when owner audit is tampered', async () => {
    const lot = await h.publish();

    await h.db.client.auction.update({
      where: { id: lot.id },
      data: { minimumIncrementCents: 101n },
    });
    expect((await owned().expect(200)).body.items[0]).toMatchObject({
      canCancel: false,
      cancelReason: 'AUDIT_TAMPERED',
      auditIntegrity: 'TAMPERED',
    });
  });
  it('verifies each lot independently in a mixed batch, including missing and pending anchors', async () => {
    const valid = await h.publish();
    const tampered = await h.publish();
    const missing = await h.publish();
    const pending = await h.publish();

    await h.bid(tampered.id, a).expect(201);
    await h.db.client.bid.updateMany({
      where: { auctionId: tampered.id },
      data: { amountCents: 1200n },
    });
    await h.auditDb.client.auditCheckpoint.delete({ where: { auctionId: missing.id } });

    const intent = await h.auditDb.client.auditIntent.findFirstOrThrow({
      where: { auctionId: pending.id },
    });

    await h.auditDb.client.auditIntent.create({
      data: {
        ...intent,
        id: randomUUID(),
        operationKey: randomUUID(),
        state: 'PREPARED',
        resolvedAt: null,
      },
    });

    const items = (await owned().expect(200)).body.items;
    const byId = (id: string) => items.find((item: { id: string }) => item.id === id);

    expect(byId(valid.id)).toMatchObject({ auditIntegrity: 'VERIFIED', canCancel: true });
    expect(byId(tampered.id)).toMatchObject({ auditIntegrity: 'TAMPERED', canCancel: false });
    expect(byId(missing.id)).toMatchObject({ auditIntegrity: 'INCOMPLETE', canCancel: false });
    expect(byId(pending.id)).toMatchObject({ auditIntegrity: 'INCOMPLETE', canCancel: false });
    for (const lot of [valid, tampered, missing, pending]) {
      expect(byId(lot.id).auditIntegrity).toBe(
        (await h.app.get(AuditService).verify(lot.id)).integrity,
      );
    }
  });
  it('fails closed for the entire page when the independent audit database cannot be read', async () => {
    await h.publish();
    await h.publish();
    jest
      .spyOn(h.app.get(AuditAnchorRepository), 'readMany')
      .mockRejectedValueOnce(new Error('private connection details'));

    const response = await owned().expect(200);

    expect(response.body.items).toHaveLength(2);
    for (const item of response.body.items) {
      expect(item).toMatchObject({ auditIntegrity: 'INCOMPLETE', canCancel: false });
    }

    expect(JSON.stringify(response.body)).not.toContain('private connection');
  });
  it('keeps database reads bounded as the owner page grows from one to twelve lots', async () => {
    for (let i = 0; i < 13; i++) {
      await h.publish();
    }

    async function measure(limit: number) {
      const spy = jest.spyOn(Client.prototype, 'query');

      try {
        const response = await owned(`?limit=${limit}`).expect(200);
        const reads = spy.mock.calls.filter(([input]) => {
          const sql = typeof input === 'string' ? input : (input as { text?: string }).text;

          return sql && /\bSELECT\b/i.test(sql);
        }).length;

        expect(response.body.items).toHaveLength(limit);
        expect(
          response.body.items.every(
            (item: { auditIntegrity: string }) => item.auditIntegrity === 'VERIFIED',
          ),
        ).toBe(true);
        expect(reads).toBeGreaterThan(0);

        return reads;
      } finally {
        spy.mockRestore();
      }
    }

    const single = await measure(1);
    const page = await measure(12);

    expect(page).toBeLessThanOrEqual(single + 2);
    process.stdout.write(`Owner page SELECT statements: one lot=${single}, twelve lots=${page}.\n`);
  });
  it('bounds image verification batches while preserving a larger page and its cursor', async () => {
    for (let i = 0; i < 26; i++) {
      await h.publish();
    }

    const read = jest.spyOn(h.app.get(AuditService), 'readLockedSnapshots');
    const response = await owned('?limit=25').expect(200);
    const ids = response.body.items.map((item: { id: string }) => item.id);

    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect(read.mock.calls.map(([batch]) => batch.length)).toEqual([12, 12, 1]);
    expect(
      response.body.items.every(
        (item: { auditIntegrity: string }) => item.auditIntegrity === 'VERIFIED',
      ),
    ).toBe(true);

    const next = await owned(
      `?limit=25&cursor=${encodeURIComponent(response.body.nextCursor)}`,
    ).expect(200);

    expect(next.body.items).toHaveLength(1);
    expect(ids).not.toContain(next.body.items[0].id);
    expect(next.body.nextCursor).toBeNull();
  });
  it('requires a live session and the correct current role for every private endpoint', async () => {
    const lot = await h.publish();

    for (const path of [
      `auctions/${lot.id}/me`,
      'me/participations',
      'auctioneer/auctions',
      'auctioneer/summary',
    ]) {
      await get(path).expect(401);
    }

    for (const path of [`auctions/${lot.id}/me`, 'me/participations']) {
      await get(path, h.seller).expect(403);
    }

    for (const path of ['auctioneer/auctions', 'auctioneer/summary']) {
      await get(path, a).expect(403);
    }

    await h.db.client.user.update({ where: { id: a.id }, data: { role: 'AUCTIONEER' } });
    await list(a).expect(403);
    await summary(a).expect(200);
    await h.db.client.authSession.updateMany({
      where: { userId: a.id },
      data: { revokedAt: new Date() },
    });
    await summary(a).expect(401);
  });
  it.each([
    '?limit=0',
    '?limit=101',
    '?limit=x',
    '?cursor=',
    '?cursor=bad',
    '?userId=other',
    '?sellerId=other',
    '?limit=2&limit=3',
  ])('rejects invalid or identity-overriding query %s', async (query) => {
    await list(a, query).expect(400);
    await owned(query).expect(400);
  });
  it('rejects unsupported filters and identity overrides on single-resource endpoints', async () => {
    const lot = await h.publish();

    await list(a, '?filter=bad').expect(400);
    await owned('?status=bad').expect(400);
    await get(`auctions/${lot.id}/me?userId=${b.id}`, a).expect(400);
    await get(`auctioneer/summary?sellerId=${a.id}`, h.seller).expect(400);
  });
});
