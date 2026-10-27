import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';
import { parseArgs, TextDecoder } from 'node:util';

import { io } from 'socket.io-client';

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    origin: { type: 'string' },
    report: { type: 'string' },
    'allow-write': { type: 'boolean' },
    'restart-gate': { type: 'string' },
  },
});

if (!values.base || !values['allow-write']) {
  throw new Error(
    'Pass --base https://host/api/v1 --allow-write. This creates permanent demo accounts, deposits and auction history.',
  );
}

const base = new URL(values.base);

assert.ok(
  base.protocol === 'https:' || ['127.0.0.1', 'localhost'].includes(base.hostname),
  'HTTPS required outside localhost.',
);
assert.equal(base.pathname, '/api/v1');
assert.ok(!base.username && !base.password && !base.search && !base.hash);

const origin = values.origin ?? base.origin;
const startedAt = new Date().toISOString();
const checks = [];
const requests = [];
const sockets = [];
const accounts = [];
const events = [];
let lot;
let receipt;
let seller;
let a;
let b;
let sellerBefore;
let financial;
const token = (account) => account.accessToken;
const iso = (ms) => new Date(ms).toISOString();

async function call(
  path,
  expected = 200,
  { body, key, account, code, method = body === undefined ? 'GET' : 'POST', headers = {} } = {},
) {
  const url = new URL(path.startsWith('/api/v1/') ? path : '/api/v1' + path, base);

  assert.equal(url.origin, base.origin, 'Never forward credentials to another origin.');

  const response = await globalThis.fetch(url, {
    method,
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(30_000),
    headers: {
      Origin: origin,
      'X-CSRF-Protection': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(account ? { Authorization: `Bearer ${token(account)}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const json =
    response.headers.get('content-type')?.includes('application/json') && bytes.length
      ? JSON.parse(new TextDecoder().decode(bytes))
      : null;

  requests.push({ method, path: url.pathname, status: response.status, code: json?.code ?? null });
  if (expected !== null) {
    assert.equal(
      response.status,
      expected,
      `${method} ${path}: expected ${expected}, received ${response.status} (${json?.code ?? 'no code'})`,
    );
  }

  if (code) {
    assert.equal(json?.code, code);
  }

  return { json, bytes, headers: response.headers, status: response.status };
}

async function confirmed(path, options, expected = 201) {
  // The SAME key/payload handles a durable 202 without creating another operation.
  for (let i = 0; i < 20; i++) {
    const response = await call(path, null, options);

    if (response.status !== 202) {
      assert.equal(
        response.status,
        expected,
        `${path}: ${response.status} (${response.json?.code ?? 'no code'})`,
      );

      return response.json;
    }

    await delay(1000);
  }

  throw new Error(`${path}: operation did not confirm within 20 attempts`);
}

async function check(name, run) {
  const start = Date.now();

  try {
    await run();
    checks.push({ name, status: 'PASS', durationMs: Date.now() - start });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    checks.push({ name, status: 'FAIL', durationMs: Date.now() - start });
    throw error;
  }
}

const wallet = async (account) => (await call('/wallet', 200, { account })).json;
const summary = async () => (await call('/auctioneer/summary', 200, { account: seller })).json;
const detail = async () => (await call(`/auctions/${lot.id}`)).json;
const audit = async () => (await call(`/auctions/${lot.id}/audit`)).json;
const participation = async (account) =>
  (await call(`/auctions/${lot.id}/me`, 200, { account })).json;
const balances = async (account, total, reserved) => {
  const result = await wallet(account);

  assert.deepEqual(
    [result.totalCents, result.reservedCents, result.availableCents],
    [total, reserved, total - reserved],
  );
};

function publicOnly(value) {
  const text = JSON.stringify(value);

  for (const account of accounts) {
    for (const secret of [account.user.id, account.user.email, token(account)]) {
      assert.ok(!text.includes(secret), 'Private account data in public response');
    }
  }

  assert.doesNotMatch(text, /"(?:email|passwordHash|wallet|bidderId|userId|sellerId|sessionId)"/);
}

async function connect(account, label) {
  const socket = io(base.origin, {
    transports: ['websocket'],
    extraHeaders: { Origin: origin },
    auth: account ? { token: token(account) } : {},
    reconnection: false,
    autoConnect: false,
    timeout: 15_000,
  });

  sockets.push(socket);
  for (const name of ['auction.updated', 'wallet.updated', 'participation.updated']) {
    socket.on(name, (data) => events.push({ label, name, data }));
  }

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });

  const ack = await socket.timeout(15_000).emitWithAck('auction.subscribe', { auctionId: lot.id });

  assert.equal(ack.ok, true);

  return socket;
}

async function settledBalances() {
  await balances(a, 100000, 0);
  await balances(b, 60000, 0);

  const after = await summary();

  assert.equal(after.totalReceivedCents, sellerBefore.totalReceivedCents + 40000);
  assert.equal(after.settledCount, sellerBefore.settledCount + 1);
  assert.equal(after.wallet.totalCents, sellerBefore.wallet.totalCents + 40000);
  assert.equal(after.wallet.reservedCents, sellerBefore.wallet.reservedCents);
  financial = {
    depositPerBidderCents: 100000,
    winningBidCents: 40000,
    loserTotalCents: 100000,
    winnerTotalCents: 60000,
    bothReservationsCents: 0,
    sellerTotalBeforeCents: sellerBefore.wallet.totalCents,
    sellerTotalAfterCents: after.wallet.totalCents,
    sellerCreditCents: after.wallet.totalCents - sellerBefore.wallet.totalCents,
  };
}

try {
  await check('HTTPS, liveness, readiness and exact CORS', async () => {
    assert.deepEqual((await call('/health/live')).json, { status: 'ok' });

    let ready;

    for (let i = 0; i < 8; i++) {
      ready = await call('/health/ready', null);
      if (ready.status === 200) {
        break;
      }

      await delay(2000);
    }

    assert.equal(ready.status, 200);
    assert.deepEqual(ready.json, { status: 'ready' });

    const cors = await call('/auctions', 204, {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Method': 'POST' },
    });

    assert.equal(cors.headers.get('access-control-allow-origin'), origin);
    await call('/wallet', 401);
  });
  await check('Demo auctioneer login and two fresh isolated bidder accounts', async () => {
    const login = await call('/auth/login', 200, {
      body: { email: 'auctioneer@demo.holobid.test', password: 'HoloBidDemo123!' },
    });

    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    if (base.protocol === 'https:') {
      assert.match(login.headers.get('set-cookie'), /Secure/);
    }

    seller = login.json;
    accounts.push(seller);
    assert.equal(seller.user.role, 'AUCTIONEER');
    for (const label of ['a', 'b']) {
      const result = await call('/auth/register', 201, {
        body: {
          email: `deploy-${label}-${randomUUID()}@example.test`,
          password: `Deploy-${randomUUID()}!`,
        },
      });

      accounts.push(result.json);
      assert.equal(result.json.user.role, 'BIDDER');
      await balances(result.json, 0, 0);
    }

    [, a, b] = accounts;
    sellerBefore = await summary();
  });
  await check('Simulated deposits, idempotent replay, conflict and invalid amount', async () => {
    const options = { account: a, key: randomUUID(), body: { amountCents: 100000 } };
    const first = (await call('/wallet/deposits', 201, options)).json;

    assert.deepEqual((await call('/wallet/deposits', 201, options)).json, first);
    await call('/wallet/deposits', 409, {
      ...options,
      body: { amountCents: 100001 },
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    await call('/wallet/deposits', 400, {
      account: a,
      key: randomUUID(),
      body: { amountCents: 0 },
    });
    await call('/wallet/deposits', 201, {
      account: b,
      key: randomUUID(),
      body: { amountCents: 100000 },
    });
    await balances(a, 100000, 0);
    await balances(b, 100000, 0);
  });
  await check('Real TCGdex import, publication replay and persisted image', async () => {
    assert.equal(
      (await call('/catalog/items/base1-58', 200, { account: seller })).json.source,
      'tcgdex',
    );

    const now = Date.now();
    const options = {
      account: seller,
      key: randomUUID(),
      body: {
        externalItemId: 'base1-58',
        startingPriceCents: 30000,
        minimumIncrementCents: 1000,
        startsAt: iso(now - 1000),
        endsAt: iso(now + 90000),
      },
    };

    lot = await confirmed('/auctions', options);
    assert.deepEqual(await confirmed('/auctions', options), lot);
    assert.equal(lot.status, 'LIVE');
    assert.equal(lot.bidCount, 0);

    const media = await call(lot.imageUrl);

    assert.match(media.headers.get('content-type'), /^image\//);
    assert.ok(media.bytes.length > 100);
    publicOnly(lot);
  });
  await check('Public and private WebSocket connections', async () => {
    await connect(null, 'public');
    await connect(a, 'a');
    await connect(b, 'b');
  });
  await check('First bid, reserved funds, anti-sniping and exact replay', async () => {
    const options = { account: a, key: randomUUID(), body: { amountCents: 30000 } };
    const first = await confirmed(`/auctions/${lot.id}/bids`, options);

    assert.deepEqual(await confirmed(`/auctions/${lot.id}/bids`, options), first);
    assert.equal(Date.parse(first.auction.endsAt), Date.parse(first.bid.acceptedAt) + 120000);
    assert.ok(Date.parse(first.auction.endsAt) > Date.parse(lot.endsAt));
    await balances(a, 100000, 30000);
    await balances(b, 100000, 0);
    assert.equal((await detail()).bidCount, 1);
  });
  await check(
    'Leading bidder, below minimum, insufficient balance and cancellation rejected',
    async () => {
      for (const [account, amountCents, status, code] of [
        [a, 31000, 409, 'ALREADY_LEADING'],
        [b, 30999, 409, 'BID_BELOW_MINIMUM'],
        [b, 100001, 422, 'INSUFFICIENT_FUNDS'],
      ]) {
        await call(`/auctions/${lot.id}/bids`, status, {
          account,
          key: randomUUID(),
          body: { amountCents },
          code,
        });
      }

      await call(`/auctions/${lot.id}/cancel`, 409, {
        account: seller,
        key: randomUUID(),
        body: {},
        code: 'AUCTION_HAS_BIDS',
      });
      assert.equal((await detail()).bidCount, 1);
    },
  );
  await check('Overbid releases previous reservation and updates both participations', async () => {
    const bid = await confirmed(`/auctions/${lot.id}/bids`, {
      account: b,
      key: randomUUID(),
      body: { amountCents: 40000 },
    });

    assert.equal(Date.parse(bid.auction.endsAt), Date.parse(bid.bid.acceptedAt) + 120000);
    await balances(a, 100000, 0);
    await balances(b, 100000, 40000);

    const pa = await participation(a);
    const pb = await participation(b);

    assert.equal(pa.state, 'OUTBID');
    assert.equal(pa.rank, 2);
    assert.equal(pb.state, 'LEADING');
    assert.equal(pb.rank, 1);

    const history = (await call(`/auctions/${lot.id}/bids`)).json;

    assert.equal(history.items.length, 2);
    publicOnly(history);

    const verified = await audit();

    assert.equal(verified.integrity, 'VERIFIED');
    assert.equal(verified.actualCount, 2);
    publicOnly(verified);
  });
  await check('Live notifications, reconnect and HTTP reconciliation', async () => {
    await delay(1000);
    for (const label of ['public', 'a', 'b']) {
      assert.ok(
        events.some(
          (e) =>
            e.label === label && e.name === 'auction.updated' && e.data.reason === 'BID_ACCEPTED',
        ),
      );
      assert.ok(
        events.some(
          (e) => e.label === label && e.name === 'auction.updated' && e.data.reason === 'EXTENDED',
        ),
      );
    }

    for (const label of ['a', 'b']) {
      assert.ok(events.some((e) => e.label === label && e.name === 'wallet.updated'));
      assert.ok(events.some((e) => e.label === label && e.name === 'participation.updated'));
    }

    assert.ok(!events.some((e) => e.label === 'public' && e.name === 'wallet.updated'));
    sockets[2].disconnect();
    await connect(b, 'b-reconnected');
    assert.equal((await detail()).currentBidCents, 40000);
    await balances(b, 100000, 40000);
  });
  await check('Automatic settlement on real clock with every WebSocket disconnected', async () => {
    const endsAt = Date.parse((await detail()).endsAt);

    for (const socket of sockets) {
      socket.disconnect();
    }

    process.stdout.write(
      `Waiting for automatic settlement at ${iso(endsAt)} (no clock override).\n`,
    );
    while (Date.now() < endsAt + 2000) {
      await delay(Math.min(10000, endsAt + 2000 - Date.now()));
    }

    let result;

    for (let i = 0; i < 20; i++) {
      result = await detail();
      if (result.settlementStatus === 'COMPLETED') {
        break;
      }

      await delay(2000);
    }

    assert.equal(result.status, 'ENDED');
    assert.equal(result.settlementStatus, 'COMPLETED');
    assert.equal(result.outcome.kind, 'SOLD');
    assert.equal(result.outcome.amountCents, 40000);
    receipt = (await call(`/receipts/${result.outcome.receiptCode}`)).json;
    assert.equal(receipt.amountCents, 40000);
    assert.equal(receipt.auctionId, lot.id);
    publicOnly(receipt);
    assert.equal((await participation(a)).state, 'LOST');
    assert.equal((await participation(b)).state, 'WON');
    assert.equal((await participation(b)).receiptCode, receipt.publicCode);
    await settledBalances();
  });
  await check('Receipt, hash chain and repeated reads do not duplicate settlement', async () => {
    const verified = await audit();

    assert.equal(verified.integrity, 'VERIFIED');
    assert.equal(verified.actualCount, 2);
    assert.equal(receipt.finalAuditHash, verified.headHash);
    assert.deepEqual((await call(`/receipts/${receipt.publicCode}`)).json, receipt);
    await call(`/auctions/${lot.id}/bids`, 409, {
      account: a,
      key: randomUUID(),
      body: { amountCents: 50000 },
      code: 'AUCTION_ENDED',
    });
    await settledBalances();
  });
  if (values['restart-gate']) {
    await check('Service restart preserves sessions, balances, receipt and audit', async () => {
      const gate = values['restart-gate'];

      assert.ok(!existsSync(gate + '.continue'), 'Use a fresh restart gate path.');
      writeFileSync(
        gate + '.ready',
        JSON.stringify({ auctionId: lot.id, receiptCode: receipt.publicCode }),
        { flag: 'wx', mode: 0o600 },
      );
      process.stdout.write(
        `READY_FOR_RESTART: restart the service, then create ${gate}.continue\n`,
      );

      const deadline = Date.now() + 480000;

      while (!existsSync(gate + '.continue')) {
        assert.ok(Date.now() < deadline, 'Restart confirmation timed out.');
        await delay(2000);
      }

      assert.deepEqual((await call('/health/ready')).json, { status: 'ready' });
      await settledBalances();
      assert.deepEqual((await call(`/receipts/${receipt.publicCode}`)).json, receipt);
      assert.equal((await audit()).integrity, 'VERIFIED');
      assert.equal((await detail()).bidCount, 2);
      await connect(b, 'after-restart');
    });
  }

  await check('Logout revokes test sessions', async () => {
    for (const account of accounts) {
      await call('/auth/logout', 204, { account, body: {} });
      await call('/auth/me', 401, { account });
    }
  });
} catch (error) {
  // Never include response bodies, headers, passwords or tokens in the report.
  process.stderr.write(`Deploy smoke failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  for (const socket of sockets) {
    socket.disconnect();
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    base: base.href,
    passed: checks.filter((c) => c.status === 'PASS').length,
    failed: checks.filter((c) => c.status === 'FAIL').length,
    restartVerified:
      Boolean(values['restart-gate']) &&
      checks.some((c) => c.name.startsWith('Service restart') && c.status === 'PASS'),
    auctionId: lot?.id,
    receiptCode: receipt?.publicCode,
    financial,
    checks,
    requests,
    eventCounts: Object.fromEntries(
      ['auction.updated', 'wallet.updated', 'participation.updated'].map((name) => [
        name,
        events.filter((e) => e.name === name).length,
      ]),
    ),
  };

  if (values.report) {
    writeFileSync(values.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }

  process.stdout.write(
    `${report.passed} passed, ${report.failed} failed; ${requests.length} HTTP requests.\n`,
  );
}
