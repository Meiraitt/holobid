import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import request from 'supertest';
import { AuctionHarness, Account } from '../helpers/auction-harness';
import { AuditAnchorRepository } from '../../src/modules/audit/audit-anchor.repository';
import { AuditSourceRepository } from '../../src/modules/audit/audit-source.repository';
import { AuditService } from '../../src/modules/audit/audit.service';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') throw new Error('Run npm run test:db.');
describe('Public bid history and integrity HTTP API', () => {
  let h: AuctionHarness; let first: Account, second: Account;
  beforeEach(async () => { h = new AuctionHarness(); await h.start(); first = await h.account('BIDDER', 1_000_000); second = await h.account('BIDDER', 1_000_000); });
  afterEach(() => h.close());
  function get(id: string, endpoint = 'audit', query = '') { return request(h.app.getHttpServer()).get(`/api/v1/auctions/${id}/${endpoint}${query}`); }
  async function chain() {
    const lot = await h.publish();
    await h.bid(lot.id, first, 1000).expect(201); await h.bid(lot.id, second, 1100).expect(201); await h.bid(lot.id, first, 1200).expect(201);
    return lot.id as string;
  }
  it('verifies an empty genesis and retains public audit/history after cancellation', async () => {
    const lot = await h.publish();
    expect((await get(lot.id).expect(200)).body).toMatchObject({ integrity: 'VERIFIED', expectedCount: 0, actualCount: 0, verifiedThroughSequence: 0, items: [], nextCursor: null, algorithmVersion: 1 });
    await h.cancel(lot.id).expect(200);
    expect((await get(lot.id).expect(200)).body).toMatchObject({ status: 'CANCELLED', integrity: 'VERIFIED' });
    expect((await get(lot.id, 'bids').expect(200)).body.items).toEqual([]);
    await h.detail(lot.id).expect(404);
  });
  it.each(['bids', 'audit'])('paginates %s newest first without repeating bids after concurrent additions', async endpoint => {
    const id = await chain();
    const a = await get(id, endpoint, '?limit=2').expect(200);
    expect(a.body.items.map((b: { sequence: number }) => b.sequence)).toEqual([3, 2]);
    await h.bid(id, second, 1300).expect(201);
    const b = await get(id, endpoint, `?limit=2&cursor=${encodeURIComponent(a.body.nextCursor)}`).expect(200);
    expect(b.body.items.map((bid: { sequence: number }) => bid.sequence)).toEqual([1]); expect(b.body.nextCursor).toBeNull();
    if (endpoint === 'audit') expect(b.body).toMatchObject({ expectedCount: 4, actualCount: 4, verifiedThroughSequence: 4, integrity: 'VERIFIED' });
    const other = await h.publish();
    await get(other.id, endpoint, `?cursor=${encodeURIComponent(a.body.nextCursor)}`).expect(400);
    await get(id, endpoint === 'bids' ? 'audit' : 'bids', `?cursor=${encodeURIComponent(a.body.nextCursor)}`).expect(400);
    await get(id, endpoint, `?cursor=x${encodeURIComponent(a.body.nextCursor)}`).expect(400);
  });
  it.each(['?limit=0', '?limit=101', '?limit=1.5', '?limit=x', '?limit[]=2', '?cursor=', '?cursor=invalid', '?userId=private', '?limit=2&limit=3'])('rejects invalid query %s', async query => {
    await get(randomUUID(), 'audit', query).expect(400); await get(randomUUID(), 'bids', query).expect(400);
  });
  it('returns 404 for unknown auctions and 400 for invalid UUIDs', async () => {
    for (const endpoint of ['audit', 'bids']) { await get(randomUUID(), endpoint).expect(404); await get('bad', endpoint).expect(400); }
  });
  it('reports deletion of primary data as tampering when the independent anchor survives', async () => {
    const lot = await h.publish(); await h.db.client.auction.delete({ where: { id: lot.id } });
    expect((await get(lot.id).expect(200)).body).toMatchObject({ integrity: 'TAMPERED', reasonCode: 'MAIN_HISTORY_MISSING', status: null, version: null, items: [] });
    await get(lot.id, 'bids').expect(404);
  });
  it('verifies bids outside the requested page and excludes all identity and authentication fields', async () => {
    const id = await chain(); const old = await h.db.client.bid.findFirstOrThrow({ where: { auctionId: id }, orderBy: { sequence: 'asc' } });
    await h.db.client.bid.update({ where: { id: old.id }, data: { amountCents: 1001n } });
    const response = await get(id, 'audit', '?limit=1').expect(200);
    expect(response.body).toMatchObject({ integrity: 'TAMPERED', firstInvalidSequence: 1, actualCount: 3 });
    expect(response.body.items[0].sequence).toBe(3);
    for (const endpoint of ['audit', 'bids']) {
      const result = await get(id, endpoint).expect(200); expect(result.headers['cache-control']).toContain('no-store');
      for (const item of result.body.items) expect(Object.keys(item).sort()).toEqual(['acceptedAt', 'amountCents', 'bidderPseudonym', 'id', 'sequence']);
      const text = JSON.stringify(result.body);
      for (const privateValue of [first.id, second.id, h.seller.id, first.token, process.env.AUDIT_HMAC_SECRET!, process.env.AUDIT_PSEUDONYM_SECRET!]) expect(text).not.toContain(privateValue);
      for (const field of ['bidderId', 'sellerId', 'userId', 'email', 'wallet', 'passwordHash', 'mac', 'auditMac']) expect(text).not.toContain(`"${field}"`);
    }
    const other = await h.publish(); expect((await get(other.id).expect(200)).body.integrity).toBe('VERIFIED');
  });
  it('reports incomplete for missing keys or anchors, without converting it to tampering', async () => {
    const lot = await h.publish();
    await h.db.client.auction.update({ where: { id: lot.id }, data: { auditKeyId: 'unavailable' } });
    expect((await get(lot.id).expect(200)).body).toMatchObject({ integrity: 'INCOMPLETE', reasonCode: 'KEY_OR_VERSION_UNAVAILABLE' });
    await h.auditDb.client.auditCheckpoint.delete({ where: { auctionId: lot.id } });
    expect((await get(lot.id).expect(200)).body).toMatchObject({ integrity: 'INCOMPLETE', reasonCode: 'ANCHOR_MISSING' });
  });
  it('reports incomplete until a prepared operation is confirmed', async () => {
    const lot = await h.publish(); const anchors = h.app.get(AuditAnchorRepository);
    jest.spyOn(anchors, 'commit').mockRejectedValueOnce(new Error('Private anchor connection'));
    const bid = await h.bid(lot.id, first).expect(202);
    expect((await get(lot.id).expect(200)).body).toMatchObject({ integrity: 'INCOMPLETE', reasonCode: 'CONFIRMATION_PENDING' });
    expect(await h.app.get(AuditService).reconcile(bid.body.operationId)).toBe('CONFIRMED');
    expect((await get(lot.id).expect(200)).body.integrity).toBe('VERIFIED');
  });
  it('sanitizes database outages and distinguishes primary from anchor unavailability', async () => {
    const lot = await h.publish(), source = h.app.get(AuditSourceRepository), anchors = h.app.get(AuditAnchorRepository);
    for (const endpoint of ['audit', 'bids']) {
      jest.spyOn(source, 'read').mockRejectedValueOnce(new Error('postgres://private-secret'));
      const result = await get(lot.id, endpoint).expect(503); expect(result.text).not.toContain('private-secret');
    }
    jest.spyOn(anchors, 'read').mockRejectedValueOnce(new Error('private-anchor'));
    expect((await get(lot.id).expect(200)).body).toMatchObject({ integrity: 'INCOMPLETE', reasonCode: 'DEPENDENCY_UNAVAILABLE' });
    jest.spyOn(anchors, 'read').mockRejectedValueOnce(new Error('private-anchor'));
    expect((await get(randomUUID()).expect(503)).text).not.toContain('private-anchor');
  });
  it('never reports tampering during legitimate concurrent HTTP writes', async () => {
    const lot = await h.publish();
    const [bid, ...reads] = await Promise.all([h.bid(lot.id, first).expect(201), ...Array.from({ length: 8 }, () => get(lot.id).expect(200))]);
    expect(bid.body.confirmation).toBe('CONFIRMED');
    for (const result of reads) {
      expect(['VERIFIED', 'INCOMPLETE']).toContain(result.body.integrity);
      expect(result.body.actualCount).toBe(result.body.items.length);
      if (result.body.integrity === 'VERIFIED') expect(result.body.expectedCount).toBe(result.body.actualCount);
    }
    expect((await get(lot.id).expect(200)).body.integrity).toBe('VERIFIED');
  });
  it('isolated tamper demonstration: mutation, restoration and deletion of the last bid', async () => {
    const id = await chain();
    const before = (await get(id).expect(200)).body; expect(before.integrity).toBe('VERIFIED');
    const rows = await h.db.client.bid.findMany({ where: { auctionId: id }, orderBy: { sequence: 'asc' } });
    await h.db.client.bid.update({ where: { id: rows[0]!.id }, data: { amountCents: 1001n } });
    expect((await get(id, 'audit', '?limit=1').expect(200)).body.integrity).toBe('TAMPERED');
    await h.db.client.bid.update({ where: { id: rows[0]!.id }, data: { amountCents: rows[0]!.amountCents } });
    expect((await get(id).expect(200)).body.integrity).toBe('VERIFIED');
    // A rollback to a correctly signed earlier head still conflicts with the separate checkpoint.
    await h.db.transaction(async tx => {
      await tx.auction.update({ where: { id }, data: { currentBidId: rows[1]!.id, bidCount: 2, auditHead: rows[1]!.hash, auditMac: rows[1]!.mac, endsAt: rows[1]!.endsAtAfter } });
      await tx.reservation.deleteMany({ where: { bidId: rows[2]!.id } });
      await tx.bid.delete({ where: { id: rows[2]!.id } });
    });
    expect((await get(id).expect(200)).body).toMatchObject({ integrity: 'TAMPERED', reasonCode: 'ANCHOR_MISMATCH', expectedCount: 3, actualCount: 2 });
    process.stdout.write('Isolated demo: VERIFIED -> altered old bid TAMPERED -> exact restoration VERIFIED -> deleted last bid TAMPERED (independent anchor).\n');
  });
  it('runs the read-only compiled verifier and rejects production execution', async () => {
    const lot = await h.publish(); const cli = join(__dirname, '../../dist/cli/audit-verify.js');
    const run = (env = process.env) => spawnSync(process.execPath, [cli, '--auction-id', lot.id], { env, encoding: 'utf8', timeout: 10_000 });
    const original = await h.db.client.auction.findUnique({ where: { id: lot.id } });
    const valid = run(); expect(valid.status).toBe(0); expect(JSON.parse(valid.stdout)).toMatchObject({ integrity: 'VERIFIED', auctionId: lot.id });
    expect(await h.db.client.auction.findUnique({ where: { id: lot.id } })).toEqual(original);
    await h.db.client.auction.update({ where: { id: lot.id }, data: { minimumIncrementCents: 101n } });
    expect(run().status).toBe(2);
    expect(run({ ...process.env, AUDIT_DATABASE_URL: 'postgresql://none:none@127.0.0.1:1/missing' }).status).toBe(3);
    expect(run({ ...process.env, NODE_ENV: 'production' }).status).toBe(1);
    const blocked = spawnSync(process.execPath, [join(__dirname, '../../scripts/test-database.mjs'), '--tamper-demo'], { env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8', timeout: 5000 });
    expect(blocked.status).toBe(1); expect(blocked.stderr).toContain('disabled in production');
  });
});
