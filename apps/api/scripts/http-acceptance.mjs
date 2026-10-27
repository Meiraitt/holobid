import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import pg from 'pg';

import { runtime } from './http-runtime.mjs';

const h = await runtime();
const { call, sql } = h;
const password = 'Acceptance password 42!';

h.credentials.push(password);

let seller;
let a;
let b;
let outsider;
let stranger;
let mainLot;
let emptyLot;
let receipt;
const token = (user) => user.accessToken;
const iso = (value) => new Date(value).toISOString();
const test = (name, ids, work) =>
  h.test(name, ids, async () => {
    await h.restart();
    await work();
  });
const auth = (route, body, status = 200, options = {}) =>
  call(`/auth/${route}`, status, { body, ...options });
const wallet = async (user) => (await call('/wallet', 200, { token: token(user) })).json;
const me = async (id, user) => (await call(`/auctions/${id}/me`, 200, { token: token(user) })).json;
const bid = (lot, user, amount = 1000, status = 201, key = randomUUID(), options = {}) =>
  call(`/auctions/${lot.id}/bids`, status, {
    token: token(user),
    key,
    body: { amountCents: amount },
    ...options,
  });
const defaults = () => ({
  externalItemId: 'base1-58',
  startingPriceCents: 1000,
  minimumIncrementCents: 100,
  startsAt: iso(h.state.now - 1000),
  endsAt: iso(h.state.now + 3_600_000),
});
const publish = async (overrides = {}, user = seller) =>
  (
    await call('/auctions', 201, {
      token: token(user),
      key: randomUUID(),
      body: { ...defaults(), ...overrides },
    })
  ).json;
const cancel = (lot, status = 200, user = seller, key = randomUUID()) =>
  call(`/auctions/${lot.id}/cancel`, status, { token: token(user), key, body: {} });
const audit = async (id) => (await call(`/auctions/${id}/audit`)).json;
const deposit = (user, amount, status = 201, key = randomUUID()) =>
  call('/wallet/deposits', status, { token: token(user), key, body: { amountCents: amount } });
const noPrivate = (value) => {
  const text = JSON.stringify(value);

  for (const user of [seller, a, b, outsider, stranger].filter(Boolean)) {
    assert.ok(!text.includes(user.user.id));
    assert.ok(!text.includes(user.user.email));
    assert.ok(!text.includes(user.accessToken));
  }

  assert.doesNotMatch(text, /"(?:email|passwordHash|wallet|bidderId|userId|sellerId|sessionId)"/);
};

const notify = (socket, name, predicate = () => true) =>
  new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      socket.off(name, listener);
      reject(new Error(`Missing ${name}`));
    }, 5000);

    function listener(data) {
      if (predicate(data)) {
        globalThis.clearTimeout(timer);
        socket.off(name, listener);
        resolve(data);
      }
    }

    socket.on(name, listener);
  });

try {
  await test(
    'health, empty public catalogue, exact CORS and unknown route',
    ['TC-027', 'TC-034', 'TC-277', 'TC-280'],
    async () => {
      assert.deepEqual((await call('/health/live')).json, { status: 'ok' });
      assert.deepEqual((await call('/health/ready')).json, { status: 'ready' });
      assert.deepEqual((await call('/auctions')).json.items, []);
      await call('/missing', 404);
      await call('/auctions', 403, {
        headers: { Origin: 'https://attacker.example' },
        code: 'INVALID_ORIGIN',
      });

      const allowed = await call('/auctions', 204, {
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization,Idempotency-Key',
        },
      });

      assert.equal(allowed.headers['access-control-allow-origin'], 'https://holobid.example');
      assert.notEqual(allowed.headers['access-control-allow-origin'], '*');
    },
  );
  await test(
    'seed accounts, repeatable seed and Argon2 hashes',
    ['TC-009', 'TC-021', 'TC-025'],
    async () => {
      for (let i = 0; i < 2; i++) {
        await h.command(process.execPath, ['dist/cli/demo-seed.js'], undefined, {
          DEMO_MODE: 'true',
        });
      }

      assert.equal((await sql.query('SELECT count(*)::int AS n FROM "User"')).rows[0].n, 3);
      for (const row of (await sql.query('SELECT "passwordHash" FROM "User"')).rows) {
        assert.match(row.passwordHash, /^\$argon2id\$/);
      }

      async function login(email) {
        const r = await auth('login', { email, password: 'HoloBidDemo123!' });

        assert.match(r.headers['set-cookie'], /HttpOnly/);
        assert.match(r.headers['set-cookie'], /Secure/);
        assert.match(r.headers['set-cookie'], /SameSite=Strict/);
        h.credentials.push(r.json.accessToken, r.cookie);

        return { ...r.json, cookie: r.cookie };
      }

      seller = await login('auctioneer@demo.holobid.test');
      a = await login('bidder1@demo.holobid.test');
      b = await login('bidder2@demo.holobid.test');
      assert.equal(seller.user.role, 'AUCTIONEER');
      assert.equal(a.user.role, 'BIDDER');
      assert.equal((await wallet(a)).totalCents, 50000);
    },
  );
  await test(
    'registration, normalization, duplicates, invalid credentials and role injection',
    ['TC-020', 'TC-023', 'TC-024', 'TC-025'],
    async () => {
      const email = `curl-${randomUUID()}@example.test`;

      outsider = (await auth('register', { email: email.toUpperCase(), password }, 201)).json;
      assert.equal(outsider.user.email, email);
      assert.equal(outsider.user.role, 'BIDDER');
      assert.equal((await wallet(outsider)).totalCents, 0);
      await auth('register', { email, password }, 409);

      const invalid = await auth('login', { email, password: 'Incorrect password!' }, 401);
      const missing = await auth('login', { email: 'absent@example.test', password }, 401);

      assert.equal(invalid.json.code, missing.json.code);
      assert.equal(invalid.json.message, missing.json.message);
      for (const body of [
        { email: 'bad', password },
        { email: 'new@example.test', password: 'short' },
        { email: 'new@example.test', password, role: 'AUCTIONEER' },
        { email: 'new@example.test', password, balance: 999 },
      ]) {
        await auth('register', body, 400);
      }

      stranger = (
        await auth('register', { email: `seller-${randomUUID()}@example.test`, password }, 201)
      ).json;
      await sql.query('UPDATE "User" SET role=\'AUCTIONEER\' WHERE id=$1', [stranger.user.id]);

      const row = (
        await sql.query('SELECT "passwordHash" FROM "User" WHERE id=$1', [outsider.user.id])
      ).rows[0];

      assert.match(row.passwordHash, /^\$argon2id\$/);
      assert.ok(!row.passwordHash.includes(password));
    },
  );
  await test(
    'auth refresh rotation, replay, CSRF, logout and concurrent refresh',
    ['TC-022', 'TC-026', 'TC-033'],
    async () => {
      let login = await auth('login', { email: outsider.user.email, password });
      const current = await auth('refresh', {}, 200, { cookie: login.cookie });

      await auth('refresh', {}, 401, { cookie: login.cookie });
      await auth('refresh', {}, 401);
      await auth('refresh', { unexpected: 1 }, 400, { cookie: current.cookie });
      await auth('login', { email: outsider.user.email, password }, 403, {
        headers: { Origin: null },
      });
      await auth('login', { email: outsider.user.email, password }, 403, {
        headers: { 'X-CSRF-Protection': null },
      });

      const results = await Promise.all([
        auth('refresh', {}, null, { cookie: current.cookie }),
        auth('refresh', {}, null, { cookie: current.cookie }),
      ]);

      assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);

      const winner = results.find((r) => r.status === 200);

      assert.ok(!results.find((r) => r.status === 401).headers['set-cookie']);
      await call('/auth/me', 200, { token: winner.json.accessToken });
      await auth('logout', {}, 204, { token: winner.json.accessToken, cookie: winner.cookie });
      await call('/auth/me', 401, { token: winner.json.accessToken });
      await auth('refresh', {}, 401, { cookie: winner.cookie });
      await auth('logout', {}, 204, { cookie: winner.cookie });
      await call('/auth/me', 401, { token: 'not-a-jwt' });
      await call('/auth/me', 401, { token: token(a).slice(0, -3) + 'xyz' });
    },
  );
  await test(
    'all private endpoints reject visitors and wrong roles',
    ['TC-027', 'TC-029', 'TC-031', 'TC-263'],
    async () => {
      mainLot = await publish();
      emptyLot = await publish();

      const protectedGets = [
        '/auth/me',
        '/wallet',
        '/catalog/items',
        '/catalog/items/base1-58',
        '/me/participations',
        '/auctioneer/auctions',
        '/auctioneer/summary',
        `/auctions/${mainLot.id}/me`,
      ];

      for (const path of protectedGets) {
        await call(path, 401);
      }

      for (const path of [
        '/catalog/items',
        '/catalog/items/base1-58',
        '/auctioneer/auctions',
        '/auctioneer/summary',
      ]) {
        await call(path, 403, { token: token(a) });
      }

      for (const path of ['/me/participations', `/auctions/${mainLot.id}/me`]) {
        await call(path, 403, { token: token(seller) });
      }

      await call('/auctions', 401, { body: defaults(), key: randomUUID() });
      await call('/auctions', 403, { body: defaults(), token: token(a), key: randomUUID() });
      await bid(mainLot, seller, 1000, 403);
      await cancel(mainLot, 403, a);
      await cancel(mainLot, 404, stranger);
      await call('/wallet/deposits', 401, { body: { amountCents: 1 }, key: randomUUID() });
      await deposit(seller, 1, 403);
      await call(`/wallet/${a.user.id}`, 404, { token: token(b) });
      await call('/auctioneer/auctions?userId=' + seller.user.id, 400, { token: token(stranger) });
    },
  );
  await test(
    'catalogue search, detail, cache, empty result and validation',
    ['TC-014', 'TC-226', 'TC-231', 'TC-233'],
    async () => {
      const opts = { token: token(seller) };
      const before = h.upstreamCalls();
      const first = await call('/catalog/items?q=Pikachu&limit=2', 200, opts);

      assert.ok(first.json.items.length);

      const after = h.upstreamCalls();

      await call('/catalog/items?q=Pikachu&limit=2', 200, opts);
      assert.equal(h.upstreamCalls(), after);
      assert.ok(after > before);
      assert.equal((await call('/catalog/items?q=empty', 200, opts)).json.items.length, 0);
      assert.equal((await call('/catalog/items/base1-58', 200, opts)).json.title, 'Pikachu');
      await call('/catalog/items/unknown', 404, opts);
      await call('/catalog/items/bad%20id', 400, opts);
      for (const query of [
        'limit=0',
        'limit=21',
        'page=-1',
        'page=1.5',
        'q=' + 'a'.repeat(81),
        'role=ADMIN',
      ]) {
        await call('/catalog/items?' + query, 400, opts);
      }
    },
  );
  if (process.env.HOLOBID_HTTP_LIVE === '1') {
    await test(
      'live TCGdex search, import and locally persisted image',
      ['TC-014', 'TC-226'],
      async () => {
        h.configure({ provider: 'live' });

        const items = (
          await call('/catalog/items?q=Pikachu&limit=2', 200, { token: token(seller) })
        ).json.items;

        assert.ok(items.length);

        const item = (await call('/catalog/items/base1-58', 200, { token: token(seller) })).json;

        assert.equal(item.source, 'tcgdex');

        const lot = await publish();

        assert.equal(lot.title, 'Pikachu');
        assert.ok((await call(lot.imageUrl.replace('/api/v1', ''))).bytes.length > 100);
        h.configure({ provider: 'fixture' });
      },
    );
  }

  await test(
    'publication validates money, timestamps, input ownership and idempotency',
    ['TC-055', 'TC-056', 'TC-057', 'TC-058', 'TC-141', 'TC-257'],
    async () => {
      for (const patch of [
        { startingPriceCents: 0 },
        { startingPriceCents: -1 },
        { startingPriceCents: 1.5 },
        { minimumIncrementCents: 0 },
        { minimumIncrementCents: '100' },
        { externalItemId: 'https://attacker.example' },
        { startsAt: 'tomorrow' },
        { startsAt: '2026-10-26T00:00:00' },
        { sellerId: a.user.id },
      ]) {
        await call('/auctions', 400, {
          token: token(seller),
          key: randomUUID(),
          body: { ...defaults(), ...patch },
        });
      }

      await call('/auctions', 400, { token: token(seller), body: defaults() });
      for (const endsAt of [iso(h.state.now - 1000), iso(h.state.now - 2000)]) {
        await call('/auctions', 400, {
          token: token(seller),
          key: randomUUID(),
          body: { ...defaults(), endsAt },
        });
      }

      const key = randomUUID();
      const body = defaults();
      const first = await call('/auctions', 201, { token: token(seller), key, body });

      assert.deepEqual(
        (await call('/auctions', 201, { token: token(seller), key, body })).json,
        first.json,
      );
      await call('/auctions', 409, {
        token: token(seller),
        key,
        body: { ...body, startingPriceCents: 1100 },
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    },
  );
  await test(
    'public status filters, pagination, cancellation and private ownership',
    ['TC-032', 'TC-034', 'TC-045', 'TC-060', 'TC-065'],
    async () => {
      const scheduled = await publish({ startsAt: iso(h.state.now + 60000) });
      const lot = await publish();
      const key = randomUUID();

      for (const status of ['LIVE', 'SCHEDULED', 'ENDED']) {
        const page = (await call('/auctions?status=' + status)).json;

        assert.ok(page.items.every((item) => item.status === status));
        noPrivate(page);
      }

      assert.equal((await call(`/auctions/${scheduled.id}`)).json.status, 'SCHEDULED');
      await cancel(lot, 200, seller, key);
      await cancel(lot, 200, seller, key);
      await call(`/auctions/${lot.id}`, 404);
      assert.equal((await audit(lot.id)).status, 'CANCELLED');
      assert.equal((await audit(lot.id)).integrity, 'VERIFIED');
      assert.deepEqual((await call(`/auctions/${lot.id}/bids`)).json.items, []);
      assert.ok(!(await call('/auctions?limit=100')).json.items.some((row) => row.id === lot.id));

      const first = (await call('/auctions?limit=1')).json;

      assert.ok(first.nextCursor);

      const next = (await call('/auctions?limit=1&cursor=' + encodeURIComponent(first.nextCursor)))
        .json;

      assert.notEqual(first.items[0].id, next.items[0].id);
      for (const query of [
        'limit=0',
        'limit=101',
        'status=CANCELLED',
        'cursor=broken',
        'q=optional-search',
      ]) {
        await call('/auctions?' + query, 400);
      }

      for (const path of [
        `/auctions/${randomUUID()}`,
        '/auctions/bad',
        `/auctions/${randomUUID()}/audit`,
        `/auctions/${randomUUID()}/bids`,
      ]) {
        await call(path, path.endsWith('/bad') ? 400 : 404);
      }

      assert.deepEqual(
        (await call('/auctioneer/auctions', 200, { token: token(stranger) })).json.items,
        [],
      );
      assert.equal(
        (await call('/auctioneer/summary', 200, { token: token(stranger) })).json
          .totalReceivedCents,
        0,
      );
      assert.equal((await me(mainLot.id, outsider)).state, 'NOT_PARTICIPATING');
    },
  );
  await test(
    'media bytes, ETag, immutable caching and missing identifiers',
    ['TC-226'],
    async () => {
      const path = mainLot.imageUrl.replace('/api/v1', '');
      const image = await call(path);

      assert.match(image.headers['content-type'], /^image\//);
      assert.match(image.headers['cache-control'], /immutable/);
      assert.equal(image.headers['x-content-type-options'], 'nosniff');
      assert.equal(
        image.headers.etag,
        '"' + createHash('sha256').update(image.bytes).digest('hex') + '"',
      );
      await call(path, 304, { headers: { 'If-None-Match': image.headers.etag } });
      await call(path, 304, { headers: { 'If-None-Match': 'W/' + image.headers.etag } });
      await call('/media/' + randomUUID(), 404);
      await call('/media/bad', 400);
    },
  );
  await test(
    'deposit validation, exact cents, concurrent idempotency and isolation',
    ['TC-091', 'TC-092', 'TC-093', 'TC-097', 'TC-248'],
    async () => {
      for (const amount of [0, -1, 0.1, '10', null, 100000000001]) {
        await deposit(outsider, amount, 400);
      }

      await call('/wallet/deposits', 400, { token: token(outsider), key: randomUUID(), body: {} });
      await call('/wallet/deposits', 400, {
        token: token(outsider),
        key: randomUUID(),
        body: { amountCents: 100, userId: a.user.id },
      });
      await call('/wallet/deposits', 400, { token: token(outsider), body: { amountCents: 1 } });

      const key = randomUUID();
      const [x, y] = await Promise.all([
        deposit(outsider, 10000, 201, key),
        deposit(outsider, 10000, 201, key),
      ]);

      assert.deepEqual(x.json, y.json);
      assert.equal((await wallet(outsider)).totalCents, 10000);
      await deposit(outsider, 10001, 409, key);
      await deposit(outsider, 10);
      await deposit(outsider, 20);
      assert.equal((await wallet(outsider)).totalCents, 10030);
      await deposit(a, 50000);
      await deposit(b, 50000);
    },
  );
  await test(
    'bid rules and private ranking with public privacy',
    [
      'TC-128',
      'TC-133',
      'TC-134',
      'TC-135',
      'TC-136',
      'TC-137',
      'TC-138',
      'TC-142',
      'TC-150',
      'TC-153',
      'TC-154',
      'TC-240',
      'TC-243',
      'TC-244',
      'TC-247',
      'TC-249',
    ],
    async () => {
      await bid(mainLot, a, 999, 409, randomUUID(), { code: 'BID_BELOW_MINIMUM' });
      await bid(mainLot, a, 100001, 422, randomUUID(), { code: 'INSUFFICIENT_FUNDS' });
      await bid(mainLot, a);
      assert.equal((await wallet(a)).reservedCents, 1000);
      await bid(mainLot, a, 1100, 409, randomUUID(), { code: 'ALREADY_LEADING' });
      await bid(mainLot, b, 1099, 409, randomUUID(), { code: 'BID_BELOW_MINIMUM' });
      await bid(mainLot, b, 1100);
      await bid(mainLot, a, 1500);
      assert.equal((await wallet(b)).reservedCents, 0);
      assert.equal((await wallet(a)).reservedCents, 1500);
      assert.equal((await me(mainLot.id, a)).rank, 1);
      assert.equal((await me(mainLot.id, b)).state, 'OUTBID');
      assert.equal((await me(mainLot.id, b)).rank, 2);
      await cancel(mainLot, 409);

      const history = (await call(`/auctions/${mainLot.id}/bids`)).json;

      assert.deepEqual(
        history.items.map((row) => row.amountCents),
        [1500, 1100, 1000],
      );
      assert.equal(history.items[0].pseudonym, history.items[2].pseudonym);
      noPrivate(history);
      noPrivate(await audit(mainLot.id));
      noPrivate((await call(`/auctions/${mainLot.id}`)).json);
    },
  );
  await test(
    'invalid bids never write, unknown auction and revoked access',
    ['TC-033', 'TC-139', 'TC-140', 'TC-141', 'TC-142', 'TC-256', 'TC-257'],
    async () => {
      for (const value of [0, -1, 1.5, '1000', null, 999999999999]) {
        await bid(mainLot, b, value, 400);
      }

      await call(`/auctions/${mainLot.id}/bids`, 400, {
        token: token(b),
        key: randomUUID(),
        raw: '{"amountCents":NaN}',
      });
      await call(`/auctions/${mainLot.id}/bids`, 400, {
        token: token(b),
        key: randomUUID(),
        body: { amountCents: 1600, bidderId: a.user.id },
      });
      await call(`/auctions/${mainLot.id}/bids`, 400, {
        token: token(b),
        body: { amountCents: 1600 },
      });
      await bid({ id: randomUUID() }, b, 1000, 404);
      await bid({ id: 'bad' }, b, 1000, 400);
      assert.equal((await audit(mainLot.id)).actualCount, 3);
    },
  );
  await test(
    'real concurrent same-value bids and duplicate retries',
    ['TC-250', 'TC-251', 'TC-216'],
    async () => {
      const lot = await publish();
      const results = await Promise.all([bid(lot, a, 1000, null), bid(lot, b, 1000, null)]);

      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal((await audit(lot.id)).integrity, 'VERIFIED');

      const next = await publish();
      const key = randomUUID();
      const repeated = await Promise.all([
        bid(next, a, 1000, null, key),
        bid(next, a, 1000, null, key),
      ]);

      assert.ok(repeated.every((r) => [201, 202].includes(r.status)));
      await bid(next, a, 1000, 201, key);
      assert.equal((await audit(next.id)).actualCount, 1);
    },
  );
  await test(
    'wallet races, full available reservation and releasing only one lot',
    ['TC-151', 'TC-152', 'TC-155', 'TC-156', 'TC-157', 'TC-158', 'TC-253'],
    async () => {
      const x = await publish();
      const y = await publish();
      const results = await Promise.all([
        bid(x, outsider, 6000, null),
        bid(y, outsider, 6000, null),
      ]);

      assert.deepEqual(results.map((r) => r.status).sort(), [201, 422]);

      const won = results[0].status === 201 ? x : y;
      const lost = won === x ? y : x;
      const available = (await wallet(outsider)).availableCents;

      await bid(lost, outsider, available + 1, 422);
      await bid(lost, outsider, available);
      assert.equal((await wallet(outsider)).availableCents, 0);
      await bid(won, b, 6100);
      assert.equal((await wallet(outsider)).reservedCents, available);
      assert.equal((await wallet(outsider)).availableCents, 6000);
    },
  );
  await test('cancellation races atomically against a first bid', ['TC-255'], async () => {
    const lot = await publish();
    const [placed, cancelled] = await Promise.all([bid(lot, b, 1000, null), cancel(lot, null)]);

    assert.deepEqual(
      [placed.status, cancelled.status],
      placed.status === 201 ? [201, 409] : [409, 200],
    );
    assert.equal((await audit(lot.id)).integrity, 'VERIFIED');
  });
  await test(
    'rollback after bid SQL writes preserves every financial value',
    ['TC-159', 'TC-274', 'TC-277'],
    async () => {
      const lot = await publish();

      await bid(lot, a);

      const wa = await wallet(a);
      const wb = await wallet(b);

      h.configure({ failBid: true });
      try {
        await bid(lot, b, 1100, 500);
      } finally {
        h.configure({ failBid: false });
      }

      for (const [user, before] of [
        [a, wa],
        [b, wb],
      ]) {
        const after = await wallet(user);

        assert.equal(after.totalCents, before.totalCents);
        assert.equal(after.reservedCents, before.reservedCents);
        assert.equal(after.version, before.version);
      }

      assert.equal((await audit(lot.id)).actualCount, 1);
      await bid(lot, b, 1100);
      assert.equal((await audit(lot.id)).integrity, 'VERIFIED');
    },
  );
  await test(
    'Socket.IO publication, outbid wallet, extension and notification failure recovery',
    ['TC-153', 'TC-154', 'TC-164'],
    async () => {
      const lot = await publish({ endsAt: iso(h.state.now + 90000) });
      const visitor = await h.socket();
      const aa = await h.socket(token(a));
      const bb = await h.socket(token(b), 'polling');

      assert.equal(
        (await visitor.timeout(3000).emitWithAck('auction.subscribe', { auctionId: lot.id })).ok,
        true,
      );

      const changed = notify(visitor, 'auction.updated', (x) => x.reason === 'BID_ACCEPTED');
      const extended = notify(visitor, 'auction.updated', (x) => x.reason === 'EXTENDED');
      const reserved = notify(aa, 'wallet.updated');

      await bid(lot, a);
      noPrivate(await changed);
      await extended;
      await reserved;

      const released = notify(aa, 'wallet.updated');
      const updated = notify(bb, 'wallet.updated');

      await bid(lot, b, 1100);
      await released;
      await updated;
      h.configure({ failNotification: true });
      await bid(lot, a, 1200);
      await delay(100);
      h.configure({ failNotification: false });
      assert.equal((await call(`/auctions/${lot.id}`)).json.currentBidCents, 1200);
      assert.equal((await audit(lot.id)).integrity, 'VERIFIED');
      visitor.disconnect();

      const reconnected = await h.socket();

      assert.equal(
        (await reconnected.timeout(3000).emitWithAck('auction.subscribe', { auctionId: lot.id }))
          .auctionVersion,
        3,
      );

      const gone = notify(aa, 'disconnect');

      await auth('logout', {}, 204, { token: token(a) });
      await gone;
      await call('/wallet', 401, { token: token(a) });
      a = {
        ...a,
        ...(await auth('login', { email: a.user.email, password: 'HoloBidDemo123!' })).json,
      };
    },
  );
  await test(
    'history pagination, cursor scope and private list validation',
    ['TC-111', 'TC-114', 'TC-263'],
    async () => {
      const first = (await call(`/auctions/${mainLot.id}/bids?limit=1`)).json;

      assert.equal(first.items[0].sequence, 3);
      assert.ok(first.nextCursor);

      const second = (
        await call(
          `/auctions/${mainLot.id}/bids?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
        )
      ).json;

      assert.equal(second.items[0].sequence, 2);
      await call(
        `/auctions/${mainLot.id}/audit?cursor=${encodeURIComponent(first.nextCursor)}`,
        400,
      );
      await call(
        `/auctions/${emptyLot.id}/bids?cursor=${encodeURIComponent(first.nextCursor)}`,
        400,
      );
      for (const route of [`/auctions/${mainLot.id}/bids`, `/auctions/${mainLot.id}/audit`]) {
        for (const q of ['limit=0', 'limit=101', 'cursor=bad', 'userId=bad']) {
          await call(route + '?' + q, 400);
        }
      }

      for (const [path, user] of [
        ['/me/participations?filter=bad', a],
        ['/auctioneer/auctions?status=bad', seller],
        ['/auctioneer/summary?userId=x', seller],
        [`/auctions/${mainLot.id}/me?userId=x`, a],
      ]) {
        await call(path, 400, { token: token(user) });
      }

      const page = (await call('/me/participations?limit=1', 200, { token: token(a) })).json;

      assert.ok(page.nextCursor);
      await call('/me/participations?cursor=' + encodeURIComponent(page.nextCursor), 400, {
        token: token(b),
      });
      await call('/me/participations?filter=active', 200, { token: token(a) });
      await call('/auctioneer/auctions?limit=1', 200, { token: token(seller) });
    },
  );

  for (const mode of ['offline', '429', 'timeout', 'malformed']) {
    await test(
      `upstream ${mode}: sanitized error with bounded latency`,
      ['TC-066', 'TC-228', 'TC-229', 'TC-230'],
      async () => {
        h.configure({ provider: mode });

        const started = Date.now();

        await call('/catalog/items?q=' + mode, 503, {
          token: token(seller),
          code: 'CATALOG_UNAVAILABLE',
        });
        assert.ok(Date.now() - started < 13000);
        if (mode === 'offline') {
          await call('/auctions', 503, {
            token: token(seller),
            key: randomUUID(),
            body: defaults(),
          });
          await call('/auctions');
          await call(`/auctions/${mainLot.id}`);
          assert.equal((await audit(mainLot.id)).integrity, 'VERIFIED');
          await call(mainLot.imageUrl.replace('/api/v1', ''));
        }

        h.configure({ provider: 'fixture' });
      },
    );
  }

  await test(
    'SQL/XSS-shaped inputs remain data and strict query inputs are rejected',
    ['TC-262'],
    async () => {
      const attack = "'; DROP TABLE users; -- <script>alert(1)</script>";

      await call('/catalog/items?q=' + encodeURIComponent(attack), 200, { token: token(seller) });
      await call('/auctions', 400, {
        token: token(seller),
        key: randomUUID(),
        body: { ...defaults(), externalItemId: attack },
      });
      await bid(mainLot, b, attack, 400);
      assert.ok((await sql.query('SELECT count(*)::int AS n FROM "User"')).rows[0].n >= 5);
    },
  );
  await test(
    'audit detects each direct SQL modification and exact restoration',
    [
      'TC-200',
      'TC-201',
      'TC-202',
      'TC-203',
      'TC-204',
      'TC-205',
      'TC-206',
      'TC-207',
      'TC-208',
      'TC-209',
      'TC-210',
      'TC-211',
      'TC-213',
      'TC-214',
    ],
    async () => {
      const id = mainLot.id;
      const rows = (
        await sql.query('SELECT * FROM "Bid" WHERE "auctionId"=$1 ORDER BY sequence', [id])
      ).rows;
      const reservations = (
        await sql.query('SELECT * FROM "Reservation" WHERE "auctionId"=$1', [id])
      ).rows;
      const original = (await sql.query('SELECT * FROM "Auction" WHERE id=$1', [id])).rows[0];

      assert.equal(rows.length, 3);

      async function restore() {
        await sql.query('DELETE FROM "Reservation" WHERE "auctionId"=$1', [id]);
        await sql.query('UPDATE "Auction" SET "currentBidId"=NULL,"bidCount"=0 WHERE id=$1', [id]);
        await sql.query('DELETE FROM "Bid" WHERE "auctionId"=$1', [id]);
        await sql.query(
          'INSERT INTO "Bid" SELECT * FROM json_populate_recordset(NULL::"Bid",$1::json)',
          [JSON.stringify(rows)],
        );
        await sql.query('UPDATE "Auction" SET "currentBidId"=$1,"bidCount"=$2 WHERE id=$3', [
          original.currentBidId,
          original.bidCount,
          id,
        ]);
        await sql.query(
          'INSERT INTO "Reservation" SELECT * FROM json_populate_recordset(NULL::"Reservation",$1::json)',
          [JSON.stringify(reservations)],
        );
      }

      const changes = {
        amount: () => sql.query('UPDATE "Bid" SET "amountCents"=9999 WHERE id=$1', [rows[1].id]),
        author: () =>
          sql.query('UPDATE "Bid" SET "bidderId"=$1 WHERE id=$2', [outsider.user.id, rows[1].id]),
        timestamp: () =>
          sql.query(
            'UPDATE "Bid" SET "acceptedAt"="acceptedAt"+interval \'1 second\' WHERE id=$1',
            [rows[1].id],
          ),
        first: () => sql.query('DELETE FROM "Bid" WHERE id=$1', [rows[0].id]),
        middle: () => sql.query('DELETE FROM "Bid" WHERE id=$1', [rows[1].id]),
        last: async () => {
          await sql.query('UPDATE "Auction" SET "currentBidId"=$1 WHERE id=$2', [rows[1].id, id]);
          await sql.query('DELETE FROM "Bid" WHERE id=$1', [rows[2].id]);
        },
        all: async () => {
          await sql.query('UPDATE "Auction" SET "currentBidId"=NULL,"bidCount"=0 WHERE id=$1', [
            id,
          ]);
          await sql.query('DELETE FROM "Bid" WHERE "auctionId"=$1', [id]);
        },
        'fake-middle': () =>
          sql.query('INSERT INTO "Bid" SELECT * FROM json_populate_record(NULL::"Bid",$1::json)', [
            JSON.stringify({ ...rows[1], id: randomUUID(), sequence: 4 }),
          ]),
        'fake-tail': () =>
          sql.query('INSERT INTO "Bid" SELECT * FROM json_populate_record(NULL::"Bid",$1::json)', [
            JSON.stringify({
              ...rows[2],
              id: randomUUID(),
              sequence: 4,
              acceptedAt: iso(h.state.now + 1),
              previousHash: rows[2].hash,
            }),
          ]),
        reorder: async () => {
          await sql.query('UPDATE "Bid" SET sequence=99 WHERE id=$1', [rows[0].id]);
          await sql.query('UPDATE "Bid" SET sequence=1 WHERE id=$1', [rows[1].id]);
          await sql.query('UPDATE "Bid" SET sequence=2 WHERE id=$1', [rows[0].id]);
        },
        'recalculated-hash': () => {
          const row = rows[1];
          const hash = createHash('sha256')
            .update(
              JSON.stringify([
                'holobid:bid',
                1,
                'v1',
                id,
                row.id,
                row.sequence,
                row.pseudonym,
                '9999',
                iso(row.acceptedAt),
                iso(row.endsAtAfter),
                row.previousHash,
              ]),
            )
            .digest('hex');

          return sql.query('UPDATE "Bid" SET "amountCents"=9999,hash=$1 WHERE id=$2', [
            hash,
            row.id,
          ]);
        },
      };

      for (const [name, change] of Object.entries(changes)) {
        await sql.query('DELETE FROM "Reservation" WHERE "auctionId"=$1', [id]);
        try {
          await change();

          const result = (
            await call(`/auctions/${id}/audit?limit=1`, 200, { label: 'tamper ' + name })
          ).json;

          assert.equal(result.integrity, 'TAMPERED', name);
          assert.equal((await audit(emptyLot.id)).integrity, 'VERIFIED');
        } finally {
          await restore();
        }

        assert.equal((await audit(id)).integrity, 'VERIFIED', name + ' restored');
      }
    },
  );
  await test(
    'start and end boundaries are decided by the server clock',
    ['TC-130', 'TC-131', 'TC-132', 'TC-254'],
    async () => {
      const scheduled = await publish({ startsAt: iso(h.state.now + 60000) });

      await bid(scheduled, a, 1000, 409, randomUUID(), { code: 'AUCTION_NOT_STARTED' });
      h.configure({ now: Date.parse(scheduled.startsAt) });
      await bid(scheduled, a);
      for (const offset of [-1000, 0, 1000]) {
        const lot = await publish({ endsAt: iso(h.state.now + 600000) });

        h.configure({ now: Date.parse(lot.endsAt) + offset });
        await bid(lot, b, 1000, offset < 0 ? 201 : 409);
      }

      const cancelled = await publish();

      await cancel(cancelled);
      await bid(cancelled, a, 1000, 409, randomUUID(), { code: 'AUCTION_CANCELLED' });
    },
  );
  await test(
    'anti-sniping outside, at and inside the threshold, successive extension',
    ['TC-160', 'TC-161', 'TC-162', 'TC-163', 'TC-164', 'TC-165', 'TC-167'],
    async () => {
      for (const remaining of [120001, 120000, 90000, 1000]) {
        const now = h.state.now;
        const lot = await publish({ endsAt: iso(now + remaining) });

        await bid(lot, a, 999, 409);
        assert.equal((await call(`/auctions/${lot.id}`)).json.endsAt, lot.endsAt);

        const accepted = await bid(lot, a);

        assert.equal(accepted.json.auction.endsAt, iso(now + Math.max(remaining, 120000)));
        if (remaining === 1000) {
          h.configure({ now: now + 60000 });

          const next = await bid(lot, b, 1100);

          assert.equal(next.json.auction.endsAt, iso(now + 180000));
          await h.restart();

          const kept = (await call(`/auctions/${lot.id}`)).json;

          assert.equal(kept.status, 'LIVE');
          assert.equal(kept.settlementStatus, 'NOT_DUE');
        }
      }
    },
  );
  await test(
    'long alternating bid sequence preserves balance and audit invariants',
    ['TC-158', 'TC-216'],
    async () => {
      const lot = await publish();

      for (let i = 0; i < 18; i++) {
        const user = i % 2 === 0 ? a : b;

        await bid(lot, user, 1000 + i * 100);
        for (const account of [a, b]) {
          const w = await wallet(account);

          assert.ok(w.reservedCents >= 0 && w.reservedCents <= w.totalCents);
          assert.equal(w.availableCents, w.totalCents - w.reservedCents);
        }
      }

      assert.equal((await audit(lot.id)).integrity, 'VERIFIED');
      assert.equal((await audit(lot.id)).actualCount, 18);
    },
  );
  await test('live lots, balances and sessions survive process restart', ['TC-260'], async () => {
    const lot = await publish();

    await bid(lot, a);

    const before = await wallet(a);

    await h.restart();
    assert.equal((await call(`/auctions/${lot.id}`)).json.status, 'LIVE');
    assert.equal((await wallet(a)).reservedCents, before.reservedCents);
    assert.equal((await audit(lot.id)).integrity, 'VERIFIED');
    await call('/auth/me', 200, { token: token(a) });
  });
  await test(
    'scheduler settles offline auctions on restart, receipts and dashboards agree',
    [
      'TC-212',
      'TC-170',
      'TC-171',
      'TC-172',
      'TC-173',
      'TC-174',
      'TC-175',
      'TC-176',
      'TC-177',
      'TC-178',
      'TC-179',
      'TC-180',
      'TC-181',
      'TC-185',
      'TC-186',
      'TC-187',
      'TC-188',
      'TC-189',
      'TC-190',
      'TC-224',
    ],
    async () => {
      // Finish every earlier lot first; this group's two lots are the only pending sales.
      await h.restart({ now: h.state.now + 86400000 });

      const x = await publish();
      const y = await publish();
      const noBid = await publish();

      await bid(x, a);
      await bid(x, b, 1100);
      await bid(y, a, 2000);

      const wa = await wallet(a);
      const wb = await wallet(b);
      const ws = await wallet(seller);
      const count = (await sql.query('SELECT count(*)::int AS n FROM "Receipt"')).rows[0].n;

      await h.stop();
      h.configure({ now: Date.parse(x.endsAt) + 1, provider: 'offline' });
      await h.boot();
      for (const lot of [x, y, noBid]) {
        assert.equal((await call(`/auctions/${lot.id}`)).json.settlementStatus, 'COMPLETED');
      }

      assert.equal((await wallet(a)).totalCents, wa.totalCents - 2000);
      assert.equal((await wallet(b)).totalCents, wb.totalCents - 1100);
      assert.equal((await wallet(seller)).totalCents, ws.totalCents + 3100);
      assert.equal((await wallet(a)).reservedCents, 0);
      assert.equal((await wallet(b)).reservedCents, 0);

      const sold = (await call(`/auctions/${x.id}`)).json;

      assert.equal(sold.outcome.kind, 'SOLD');
      receipt = (await call('/receipts/' + sold.outcome.receiptCode)).json;
      assert.equal(receipt.amountCents, 1100);
      assert.equal(receipt.title, 'Pikachu');
      assert.ok(receipt.settledAt && receipt.winnerPseudonym);
      assert.match(receipt.publicCode, /^[A-Za-z0-9_-]{32}$/);
      noPrivate(receipt);
      await call(receipt.imageUrl.replace('/api/v1', ''));
      assert.equal((await audit(x.id)).integrity, 'VERIFIED');
      assert.equal((await call(`/auctions/${noBid.id}`)).json.outcome.kind, 'NO_BIDS');
      await call('/receipts/invalid', 404);
      await call('/receipts/' + 'z'.repeat(32), 404);
      assert.equal((await me(x.id, b)).state, 'WON');
      assert.equal((await me(x.id, a)).state, 'LOST');
      assert.equal((await me(x.id, b)).receiptCode, receipt.publicCode);
      assert.equal((await me(x.id, a)).receiptCode, null);

      const wins = (await call('/me/participations?filter=won', 200, { token: token(b) })).json;

      assert.ok(wins.items.some((row) => row.auctionId === x.id));
      assert.ok(wins.items.every((row) => row.state === 'WON'));

      const summary = (await call('/auctioneer/summary', 200, { token: token(seller) })).json;

      assert.equal(summary.totalReceivedCents, (await wallet(seller)).totalCents);
      await h.restart();
      assert.equal(
        (await sql.query('SELECT count(*)::int AS n FROM "Receipt"')).rows[0].n,
        count + 2,
      );
      assert.equal((await wallet(seller)).totalCents, ws.totalCents + 3100);

      const row = (
        await sql.query(
          'SELECT id,"amountCents" FROM "Bid" WHERE "auctionId"=$1 ORDER BY sequence LIMIT 1',
          [x.id],
        )
      ).rows[0];

      await sql.query('UPDATE "Bid" SET "amountCents"="amountCents"+1 WHERE id=$1', [row.id]);
      assert.equal((await audit(x.id)).integrity, 'TAMPERED');
      assert.deepEqual((await call('/receipts/' + receipt.publicCode)).json, receipt);
      await sql.query('UPDATE "Bid" SET "amountCents"=$1 WHERE id=$2', [row.amountCents, row.id]);
      assert.equal((await audit(x.id)).integrity, 'VERIFIED');
      h.configure({ provider: 'fixture' });
    },
  );
  await test(
    'expired JWT is refused even while the database session is valid',
    ['TC-033'],
    async () => {
      const [header, encoded] = token(b).split('.');
      const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      const exp = Math.floor(Date.now() / 1000) - 1;
      const body = Buffer.from(JSON.stringify({ ...claims, iat: exp - 900, exp })).toString(
        'base64url',
      );
      const signed = header + '.' + body;
      const signature = createHmac('sha256', Buffer.from(h.env.JWT_SECRET, 'base64url'))
        .update(signed)
        .digest('base64url');

      await call('/auth/me', 401, { token: signed + '.' + signature });
      await call('/auth/me', 200, { token: token(b) });
    },
  );
  await test(
    'scheduler completes a due winning lot without connected clients',
    ['TC-177'],
    async () => {
      const lot = await publish();

      await bid(lot, b);

      const before = await wallet(b);
      const sellerBefore = await wallet(seller);

      // Boot before the deadline, then let the actual timer fire after advancing only domain time.
      await h.restart({ now: Date.parse(lot.endsAt) - 1500 });
      h.configure({ now: Date.parse(lot.endsAt) + 1 });
      await delay(1800);
      assert.equal((await call(`/auctions/${lot.id}`)).json.settlementStatus, 'COMPLETED');
      assert.equal((await wallet(b)).totalCents, before.totalCents - 1000);
      assert.equal((await wallet(seller)).totalCents, sellerBefore.totalCents + 1000);
    },
  );
  await test(
    'independent audit database outage fails closed and recovers',
    ['TC-200', 'TC-277'],
    async () => {
      const anchor = new pg.Pool({ connectionString: h.env.AUDIT_DATABASE_URL });

      try {
        await anchor.query('ALTER DATABASE holobid_audit CONNECTION LIMIT 0');
        await anchor.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()',
        );
        await call('/health/ready', 503);
        await call('/health/live');
        assert.equal((await audit(mainLot.id)).integrity, 'INCOMPLETE');
        await call('/auctions', 503, { token: token(seller), key: randomUUID(), body: defaults() });
      } finally {
        await anchor.query('ALTER DATABASE holobid_audit CONNECTION LIMIT -1');
        await anchor.end();
      }

      await call('/health/ready');
      assert.equal((await audit(mainLot.id)).integrity, 'VERIFIED');
    },
  );
  await test(
    'inconsistent winner balance fails settlement without creating money',
    ['TC-261'],
    async () => {
      const lot = await publish();

      await bid(lot, a);

      const before = await wallet(seller);

      await assert.rejects(
        sql.query('UPDATE "Wallet" SET "totalCents"=0 WHERE "userId"=$1', [a.user.id]),
        { code: '23514' },
      );
      await sql.query('UPDATE "Wallet" SET "totalCents"=0,"reservedCents"=0 WHERE "userId"=$1', [
        a.user.id,
      ]);
      await h.restart({ now: Date.parse(lot.endsAt) + 1 });

      const detail = (await call(`/auctions/${lot.id}`)).json;

      assert.equal(detail.settlementStatus, 'FAILED');
      assert.equal((await wallet(seller)).totalCents, before.totalCents);
      assert.equal((await wallet(a)).totalCents, 0);
      assert.equal(
        (await sql.query('SELECT count(*)::int AS n FROM "Receipt" WHERE "auctionId"=$1', [lot.id]))
          .rows[0].n,
        0,
      );
    },
  );
  await test(
    'login and bid rate limits return Retry-After without mutation',
    ['TC-281'],
    async () => {
      for (let i = 0; i < 5; i++) {
        await auth('login', { email: 'rate@example.test', password }, 401);
      }

      const limited = await auth('login', { email: 'rate@example.test', password }, 429);

      assert.ok(Number(limited.headers['retry-after']) > 0);

      const lot = await publish();

      for (let i = 0; i < 10; i++) {
        await bid(lot, b, 999, 409);
      }

      const bidLimit = await bid(lot, b, 1000, 429);

      assert.ok(Number(bidLimit.headers['retry-after']) > 0);
      assert.equal((await audit(lot.id)).actualCount, 0);
    },
  );
  await test(
    'readiness reports a real database outage while liveness remains available',
    ['TC-277'],
    async () => {
      // Only this disposable runner's database; the HTTP process keeps serving liveness.
      await sql.query('ALTER DATABASE holobid CONNECTION LIMIT 0');
      await sql.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()',
      );
      try {
        await call('/health/ready', 503);
        await call('/health/live');
      } finally {
        await sql.query('ALTER DATABASE holobid CONNECTION LIMIT -1');
      }

      await call('/health/ready');
    },
  );
} finally {
  await h.close();
}
