import { Buffer } from 'node:buffer';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { InfiniteQueryObserver, QueryObserver } from '@tanstack/react-query';
import pg from 'pg';
import { io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  AuctionDetail,
  AuthResponse,
  CredentialsInput,
  PublicReceipt,
} from '@holobid/contracts';

import { SessionController } from '../auth/session-controller';
import { clearPrivateQueries, createQueryClient, queryKeys } from '../lib/query-client';
import { ApiClient } from '../services/api-client';
import { ApiRequestError, errorMessage } from '../services/api-error';
import { mediaUrl } from '../services/media-url';
import { createOperation } from '../services/operations';
import { resourceServices } from '../services/resource-services';
import { myBidOptions, roomOptions } from '../views/auction-room/room-queries';
import { participationResult } from '../views/participations/components/ParticipationRow';
import { participationOptions } from '../views/participations/participation-queries';
import { receiptOptions } from '../views/receipt/receipt-queries';
import { depositAttempt } from '../views/wallet/deposit-attempt';
import { reservationOptions, walletOptions } from '../views/wallet/wallet-queries';

import { RealtimeClient } from './realtime-client';

const origin = process.env.HOLOBID_WEB_API_URL!;
const webOrigin = process.env.HOLOBID_WEB_TEST_ORIGIN!;
const control = process.env.HOLOBID_HTTP_CONTROL!;
const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
const nativeFetch = globalThis.fetch;
let httpRequests = 0;
let depositRequests = 0;
let loseDepositResponse = false;
const publicAuthHeaders: string[] = [];
let wsEvents = 0;
const dispose: Array<() => void> = [];
const configure = (patch: object) =>
  writeFileSync(
    control,
    JSON.stringify({ ...JSON.parse(readFileSync(control, 'utf8')), ...patch }),
  );
let now = 0;
let seller: Awaited<ReturnType<typeof person>>;
let a: Awaited<ReturnType<typeof person>>;
let b: Awaited<ReturnType<typeof person>>;
const lots: AuctionDetail[] = [];

async function person(label: string, auctioneer = false, shortToken = false) {
  let cookie = '';
  let signedOut = false;
  let refreshCount = 0;
  const cache = createQueryClient();
  const credentials = {
    email: `${label}-${randomUUID()}@holobid.test`,
    password: 'Realtime-2026!',
  };

  async function authCall(path: string, body: object = {}, token?: string): Promise<AuthResponse> {
    const response = await fetch(`${origin}/api/v1/auth/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Protection': '1',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const setCookie = response.headers.getSetCookie()[0];

    if (setCookie) {
      cookie = setCookie.split(';')[0]!;
    }

    if (!response.ok) {
      throw new Error(`Auth ${path}: ${response.status}`);
    }

    return response.status === 204 ? (undefined as unknown as AuthResponse) : response.json();
  }

  const auth = {
    register: async (input: CredentialsInput) => {
      const result = await authCall('register', input);

      if (shortToken) {
        const [header, payload] = result.accessToken.split('.');
        const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
        const expiresAt = Math.floor(Date.now() / 1000) + 2;
        const encoded = Buffer.from(
          JSON.stringify({
            ...claims,
            iat: expiresAt - 900,
            exp: expiresAt,
          }),
        ).toString('base64url');
        const content = `${header}.${encoded}`;

        result.accessToken = `${content}.${createHmac('sha256', Buffer.from(process.env.JWT_SECRET!, 'base64url')).update(content).digest('base64url')}`;
      }

      return result;
    },
    login: (input: CredentialsInput) => authCall('login', input),
    refresh: () => {
      refreshCount++;

      return authCall('refresh');
    },
    logout: async (token?: string) => {
      await authCall('logout', {}, token);
    },
    me: async (): Promise<AuthResponse['user']> => session.getSnapshot().user!,
  };
  const session = new SessionController(
    auth,
    {
      exclusive: (work) => work(),
      signedOut: () => signedOut,
      publish: (state) => {
        signedOut = state === 'signed-out';
      },
      subscribe: () => () => {},
    },
    () => clearPrivateQueries(cache),
  );
  const user = await session.signIn('register', credentials);

  if (auctioneer) {
    await sql.query(`UPDATE "User" SET role='AUCTIONEER' WHERE id=$1`, [user.id]);
    await session.signIn('login', credentials);
  }

  const client = new ApiClient(origin);

  client.bindSession(session);

  const api = resourceServices(client);
  const sockets: ReturnType<typeof io>[] = [];
  const events: string[] = [];
  const manager = new RealtimeClient(cache, session, (token) => {
    const socket = io(origin, {
      autoConnect: false,
      forceNew: true,
      transports: ['websocket'],
      reconnectionDelay: 50,
      reconnectionDelayMax: 100,
      extraHeaders: { Origin: webOrigin },
      auth: token ? { token } : {},
    });

    socket.onAny((name: string) => {
      wsEvents++;
      events.push(name);
    });
    sockets.push(socket);

    return socket;
  });

  dispose.push(() => {
    manager.stop();
    cache.clear();
  });

  return {
    id: user.id,
    api,
    client,
    cache,
    session,
    manager,
    sockets,
    events,
    credentials,
    auth,
    refreshCount: () => refreshCount,
  };
}

function observe(context: Awaited<ReturnType<typeof person>>, id: string) {
  const options = {
    ...roomOptions(id, context.api.auctions),
    refetchInterval: false as const,
    enabled: false,
  };
  const room = new QueryObserver(context.cache, options);
  const wallet = new QueryObserver(context.cache, {
    queryKey: queryKeys.private(context.id, 'wallet'),
    queryFn: ({ signal }) => context.api.wallet.get(signal),
    enabled: false,
  });
  const mine = new QueryObserver(context.cache, {
    ...myBidOptions(context.id, id, context.api.auctions),
    refetchInterval: false,
    enabled: false,
  });
  const off = [room.subscribe(() => {}), wallet.subscribe(() => {}), mine.subscribe(() => {})];
  const watch = context.manager.watchAuction(id);
  const listen = context.manager.subscribe(() => {
    const enabled = context.manager.getSnapshot().rooms[id] === 'joined';
    const authenticated = enabled && context.session.getSnapshot().user?.id === context.id;

    room.setOptions({ ...options, enabled });
    wallet.setOptions({
      queryKey: queryKeys.private(context.id, 'wallet'),
      queryFn: ({ signal }) => context.api.wallet.get(signal),
      enabled: authenticated,
    });
    mine.setOptions({
      ...myBidOptions(context.id, id, context.api.auctions),
      refetchInterval: false,
      enabled: authenticated,
    });
  });
  const close = () => {
    listen();
    watch();
    off.forEach((fn) => fn());
    room.destroy();
    wallet.destroy();
    mine.destroy();
  };

  dispose.push(close);
  context.manager.start();

  return { room, wallet, mine, close };
}

beforeAll(async () => {
  expect(process.env.HOLOBID_ISOLATED_DATABASE_TEST).toBe('1');
  expect(new URL(process.env.DATABASE_URL!).hostname).toBe('127.0.0.1');
  now = JSON.parse(readFileSync(control, 'utf8')).now;
  await sql.connect();
  vi.stubGlobal('fetch', async (url: string | URL, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);

    headers.set('Origin', webOrigin);
    if (String(url).includes('/receipts/') && headers.has('Authorization')) {
      publicAuthHeaders.push(String(url));
    }

    const response = await nativeFetch(url, { ...options, headers });

    httpRequests++;
    if (options.method === 'POST' && String(url).endsWith('/wallet/deposits')) {
      depositRequests++;
      if (loseDepositResponse && response.ok) {
        loseDepositResponse = false;
        throw new TypeError('Test: response lost after the server committed the deposit');
      }
    }

    return response;
  });
  seller = await person('seller', true);
  a = await person('bidder-a');
  b = await person('bidder-b');
  for (let i = 0; i < 3; i++) {
    const result = await seller.api.auctions.create(
      createOperation({
        externalItemId: 'base1-58',
        startingPriceCents: 1000,
        minimumIncrementCents: 100,
        startsAt: new Date(now - 1000).toISOString(),
        endsAt: new Date(now + 600000).toISOString(),
      }),
    );

    lots.push(result.data as AuctionDetail);
  }

  await a.api.wallet.deposit(createOperation({ amountCents: 10000 }));
  await b.api.wallet.deposit(createOperation({ amountCents: 10000 }));
});

afterAll(async () => {
  dispose.reverse().forEach((fn) => fn());
  vi.unstubAllGlobals();
  await sql.end();
  process.stdout.write(
    `Frontend realtime/wallet: ${httpRequests} real HTTP requests; ${wsEvents} real Socket.IO events over WebSocket.\n`,
  );
});

describe('frontend synchronization with real HTTP and WebSocket', () => {
  let observedA: ReturnType<typeof observe>;
  let observedB: ReturnType<typeof observe>;

  it('subscribes with ACK before loading snapshots and connects two separate private contexts', async () => {
    observedA = observe(a, lots[0]!.id);
    observedB = observe(b, lots[0]!.id);
    await vi.waitFor(() => {
      expect(a.manager.getSnapshot().phase).toBe('ready');
      expect(observedA.room.getCurrentResult().data?.auction.id).toBe(lots[0]!.id);
      expect(observedB.wallet.getCurrentResult().data?.availableCents).toBe(10000);
    });
    expect(a.sockets[0]!.io.engine.transport.name).toBe('websocket');
    expect(b.sockets[0]!.io.engine.transport.name).toBe('websocket');
    expect(a.sockets[0]!.id).not.toBe(b.sockets[0]!.id);
  });
  it('updates price, own position and reservation on both clients without polling or reload', async () => {
    await a.api.auctions.bid(lots[0]!.id, createOperation({ amountCents: 1000 }));
    await vi.waitFor(() => {
      expect(observedB.room.getCurrentResult().data?.auction.currentBidCents).toBe(1000);
      expect(observedA.mine.getCurrentResult().data?.state).toBe('LEADING');
      expect(observedA.wallet.getCurrentResult().data?.reservedCents).toBe(1000);
    });
    await b.api.auctions.bid(lots[0]!.id, createOperation({ amountCents: 1100 }));
    await vi.waitFor(() => {
      expect(observedA.mine.getCurrentResult().data?.state).toBe('OUTBID');
      expect(observedA.wallet.getCurrentResult().data?.availableCents).toBe(10000);
      expect(observedB.mine.getCurrentResult().data?.state).toBe('LEADING');
    });
    expect(a.events).toContain('wallet.updated');
    expect(a.events).toContain('participation.updated');
  });
  it('delivers private deposit notifications only to the owning account', async () => {
    await vi.waitFor(() => expect(b.manager.getSnapshot().phase).toBe('ready'));

    const before = b.events.filter((event) => event === 'wallet.updated').length;

    await a.api.wallet.deposit(createOperation({ amountCents: 12345 }));
    await vi.waitFor(() =>
      expect(observedA.wallet.getCurrentResult().data?.totalCents).toBe(22345),
    );
    expect(b.events.filter((event) => event === 'wallet.updated')).toHaveLength(before);
    expect(observedB.wallet.getCurrentResult().data?.totalCents).toBe(10000);
  });
  it('blocks after a real transport loss and recovers a bid missed while disconnected', async () => {
    const socket = a.sockets.at(-1)!;

    socket.io.reconnection(false);
    socket.io.engine.close();
    await vi.waitFor(() => expect(a.manager.getSnapshot().phase).toBe('disconnected'));
    await a.api.auctions.bid(lots[0]!.id, createOperation({ amountCents: 1200 }));
    expect(observedA.room.getCurrentResult().data?.auction.currentBidCents).toBe(1100);
    socket.io.reconnection(true);
    a.manager.retry();
    await vi.waitFor(() => {
      expect(a.manager.getSnapshot().phase).toBe('ready');
      expect(observedA.room.getCurrentResult().data?.auction.currentBidCents).toBe(1200);
      expect(observedA.wallet.getCurrentResult().data?.reservedCents).toBe(1200);
    });
  });
  it('receives an extended deadline and recovers notifications lost after the HTTP commit', async () => {
    configure({ now: now + 590000 });
    await b.api.auctions.bid(lots[0]!.id, createOperation({ amountCents: 1300 }));
    await vi.waitFor(() =>
      expect(observedA.room.getCurrentResult().data?.auction.endsAt).toBe(
        new Date(now + 710000).toISOString(),
      ),
    );
    configure({ failNotification: true });
    await a.api.auctions.bid(lots[0]!.id, createOperation({ amountCents: 1400 }));
    configure({ failNotification: false });
    a.sockets.at(-1)!.disconnect();
    a.manager.retry();
    await vi.waitFor(() =>
      expect(observedA.room.getCurrentResult().data?.auction.currentBidCents).toBe(1400),
    );
  });
  it('recreates the authenticated socket after a real HTTP refresh and handles remote revocation', async () => {
    const previous = b.sockets.at(-1)!;

    const issuedAt = JSON.parse(
      Buffer.from(b.session.token()!.split('.')[1]!, 'base64url').toString(),
    ).iat;

    // JWT claims have second precision; same-second refresh can legitimately return the same token.
    await vi.waitFor(() => expect(Math.floor(Date.now() / 1000)).toBeGreaterThan(issuedAt), {
      timeout: 2000,
    });
    await b.session.refresh(b.session.token());
    await vi.waitFor(() => expect(b.manager.getSnapshot().phase).toBe('ready'));
    expect(b.sockets.at(-1)).not.toBe(previous);
    expect(previous.listeners('wallet.updated')).toHaveLength(0);
    expect(previous.connected).toBe(false);
    await b.auth.logout(b.session.token()!);
    await vi.waitFor(() => expect(b.session.getSnapshot().status).toBe('anonymous'));
    expect(
      b.cache
        .getQueryCache()
        .findAll({ queryKey: ['private'] })
        .every((query) => query.state.data === undefined),
    ).toBe(true);
  });
  it('renews once when a real socket emits auth.expired', async () => {
    const expiring = await person('expiring', false, true);

    expiring.manager.start();
    await vi.waitFor(() => expect(expiring.manager.getSnapshot().phase).toBe('ready'));

    const old = expiring.sockets[0]!;

    await vi.waitFor(() => expect(expiring.refreshCount()).toBe(1), {
      timeout: 5000,
      interval: 100,
    });
    await vi.waitFor(() => expect(expiring.manager.getSnapshot().phase).toBe('ready'));
    expect(expiring.events).toContain('auth.expired');
    expect(old.connected).toBe(false);
    expect(expiring.session.getSnapshot().status).toBe('authenticated');
    expiring.manager.stop();
  });
  it('unsubscribes when leaving the room and survives a mount/cleanup/remount cycle', async () => {
    observedA.close();
    observedB.close();

    const socket = a.sockets.at(-1)!;

    await new Promise<void>((resolve) =>
      socket.timeout(3000).emit('auction.unsubscribe', { auctionId: lots[0]!.id }, () => resolve()),
    );

    const count = a.events.filter((name) => name === 'auction.updated').length;

    await b.session.signIn('login', b.credentials);
    await b.api.auctions.bid(lots[0]!.id, createOperation({ amountCents: 1500 }));
    await vi.waitFor(() =>
      expect(a.events.filter((name) => name === 'participation.updated').length).toBeGreaterThan(0),
    );
    expect(a.events.filter((name) => name === 'auction.updated')).toHaveLength(count);
    a.manager.stop();

    const second = observe(a, lots[0]!.id);

    await vi.waitFor(() =>
      expect(second.room.getCurrentResult().data?.auction.currentBidCents).toBe(1500),
    );
    expect(a.sockets.at(-1)!.listeners('auction.updated')).toHaveLength(1);
    second.close();
  });
});

function memoryStore(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function observeWallet(context: Awaited<ReturnType<typeof person>>) {
  const wallet = new QueryObserver(context.cache, {
    ...walletOptions(context.id, context.api.wallet),
    refetchInterval: false,
  });
  const reservations = new InfiniteQueryObserver(context.cache, {
    ...reservationOptions(context.id, context.api.account, 1),
    refetchInterval: false,
  });
  const off = [wallet.subscribe(() => {}), reservations.subscribe(() => {})];

  dispose.push(() => {
    off.forEach((fn) => fn());
    wallet.destroy();
    reservations.destroy();
  });
  context.manager.start();

  return { wallet, reservations };
}

describe('wallet view services with real HTTP, persistence and WebSocket', () => {
  let c: Awaited<ReturnType<typeof person>>;
  let d: Awaited<ReturnType<typeof person>>;
  let observedC: ReturnType<typeof observeWallet>;
  let observedD: ReturnType<typeof observeWallet>;
  const store = memoryStore();
  const entryCount = async () =>
    Number(
      (
        await sql.query(`SELECT COUNT(*) FROM "WalletEntry" WHERE "userId"=$1 AND type='DEPOSIT'`, [
          c.id,
        ])
      ).rows[0].count,
    );

  it('loads an actual zero wallet and an empty reservation page for new accounts', async () => {
    c = await person('wallet-c');
    d = await person('wallet-d');
    observedC = observeWallet(c);
    observedD = observeWallet(d);
    await vi.waitFor(() => {
      expect(c.manager.getSnapshot().phase).toBe('ready');
      expect(d.manager.getSnapshot().phase).toBe('ready');
      expect(observedC.wallet.getCurrentResult().data).toMatchObject({
        totalCents: 0,
        reservedCents: 0,
        availableCents: 0,
      });
      expect(observedC.reservations.getCurrentResult().data?.pages[0]?.items).toEqual([]);
    });
    expect(c.sockets[0]!.io.engine.transport.name).toBe('websocket');
  });

  it('rejects invalid cents and disallowed roles through real HTTP', async () => {
    for (const amountCents of [0, -1, 1.5, 100_000_000_001]) {
      await expect(c.api.wallet.deposit(createOperation({ amountCents }))).rejects.toMatchObject({
        status: 400,
      });
    }

    await expect(
      seller.api.wallet.deposit(createOperation({ amountCents: 100 })),
    ).rejects.toMatchObject({ status: 403 });

    const guest = resourceServices(new ApiClient(origin));

    await expect(guest.wallet.deposit(createOperation({ amountCents: 100 }))).rejects.toMatchObject(
      { status: 401 },
    );
    expect(await entryCount()).toBe(0);
    expect((await c.api.wallet.get()).totalCents).toBe(0);
  });

  it('credits one exact-cent deposit on a double submit and updates only its private wallet', async () => {
    const attempt = depositAttempt(c.api.wallet.deposit, store, c.id);
    const before = depositRequests;
    const otherEvents = d.events.filter((name) => name === 'wallet.updated').length;
    const first = attempt.submit({ amountCents: 12345 });

    expect(attempt.submit({ amountCents: 99999 })).toBe(first);

    const result = await first;

    expect(result.status).toBe(201);
    expect(attempt.operation).toBeUndefined();
    expect(store.length).toBe(0);
    expect(depositRequests - before).toBe(1);
    expect(await entryCount()).toBe(1);
    await vi.waitFor(() =>
      expect(observedC.wallet.getCurrentResult().data).toMatchObject({
        totalCents: 12345,
        availableCents: 12345,
        reservedCents: 0,
      }),
    );
    expect(d.events.filter((name) => name === 'wallet.updated')).toHaveLength(otherEvents);
    expect(observedD.wallet.getCurrentResult().data?.totalCents).toBe(0);
  });

  it('recovers a committed deposit after response loss/reload without re-crediting or using the stale replay balance', async () => {
    const attempt = depositAttempt(c.api.wallet.deposit, store, c.id);

    loseDepositResponse = true;
    await expect(attempt.submit({ amountCents: 6789 })).rejects.toBeInstanceOf(ApiRequestError);

    const operation = attempt.operation!;

    expect(operation.input.amountCents).toBe(6789);
    expect(depositAttempt(d.api.wallet.deposit, store, d.id).operation).toBeUndefined();
    await vi.waitFor(() =>
      expect(observedC.wallet.getCurrentResult().data?.totalCents).toBe(19134),
    );
    await c.api.wallet.deposit(createOperation({ amountCents: 100 }));
    await vi.waitFor(() =>
      expect(observedC.wallet.getCurrentResult().data?.totalCents).toBe(19234),
    );

    const restored = depositAttempt(c.api.wallet.deposit, store, c.id);

    expect(restored.operation).toEqual(operation);

    const replay = await restored.submit({ amountCents: 777 });

    expect(replay.data.wallet.totalCents).toBe(19134);
    expect(restored.operation).toBeUndefined();
    expect(store.length).toBe(0);
    await c.cache.invalidateQueries({ queryKey: ['private', c.id] });
    expect(observedC.wallet.getCurrentResult().data?.totalCents).toBe(19234);
    expect(await entryCount()).toBe(3);
  });

  it('reserves two lots and paginates reservations without deriving totals from a partial page', async () => {
    await d.api.wallet.deposit(createOperation({ amountCents: 10000 }));
    await c.api.auctions.bid(lots[1]!.id, createOperation({ amountCents: 1000 }));
    await c.api.auctions.bid(lots[2]!.id, createOperation({ amountCents: 2000 }));
    await vi.waitFor(() => {
      expect(observedC.wallet.getCurrentResult().data).toMatchObject({
        totalCents: 19234,
        reservedCents: 3000,
        availableCents: 16234,
      });
      expect(observedC.reservations.getCurrentResult().hasNextPage).toBe(true);
    });
    await observedC.reservations.fetchNextPage();

    const items = observedC.reservations
      .getCurrentResult()
      .data!.pages.flatMap((page) => page.items);

    expect(new Set(items.map((item) => item.auctionId))).toEqual(
      new Set([lots[1]!.id, lots[2]!.id]),
    );
    expect(items.map((item) => item.reservedForThisAuctionCents).sort((x, y) => x - y)).toEqual([
      1000, 2000,
    ]);
    expect(observedC.reservations.getCurrentResult().hasNextPage).toBe(false);
  });

  it('releases the outbid reservation on both real clients without changing either total', async () => {
    await d.api.auctions.bid(lots[1]!.id, createOperation({ amountCents: 1100 }));
    await vi.waitFor(() => {
      expect(observedC.wallet.getCurrentResult().data).toMatchObject({
        totalCents: 19234,
        reservedCents: 2000,
        availableCents: 17234,
      });
      expect(observedD.wallet.getCurrentResult().data).toMatchObject({
        totalCents: 10000,
        reservedCents: 1100,
        availableCents: 8900,
      });
      expect(
        observedC.reservations
          .getCurrentResult()
          .data?.pages.flatMap((page) => page.items)
          .filter((item) => item.reservedForThisAuctionCents > 0)
          .map((item) => item.auctionId),
      ).toEqual([lots[2]!.id]);
    });
  });

  it('reconciles settlement debits and clears reservations via real server events', async () => {
    configure({ now: now + 710001, reconcileSettlements: true });
    await vi.waitFor(
      () => {
        expect(observedC.wallet.getCurrentResult().data).toMatchObject({
          totalCents: 17234,
          reservedCents: 0,
          availableCents: 17234,
        });
        expect(observedD.wallet.getCurrentResult().data).toMatchObject({
          totalCents: 8900,
          reservedCents: 0,
          availableCents: 8900,
        });
        expect(
          observedC.reservations
            .getCurrentResult()
            .data?.pages.flatMap((page) => page.items)
            .filter((item) => item.reservedForThisAuctionCents > 0),
        ).toEqual([]);
        expect(
          observedD.reservations
            .getCurrentResult()
            .data?.pages.flatMap((page) => page.items)
            .filter((item) => item.reservedForThisAuctionCents > 0),
        ).toEqual([]);
      },
      { timeout: 10000, interval: 100 },
    );
    configure({ reconcileSettlements: false });
    expect(c.events).toContain('wallet.updated');
    expect(d.events).toContain('participation.updated');
    expect(await entryCount()).toBe(3);
  });
  it('handles balance-limit rejection, correction and throttling while allowing exact idempotent replay', async () => {
    const attempt = depositAttempt(c.api.wallet.deposit, store, c.id);

    await expect(attempt.submit({ amountCents: 100_000_000_000 })).rejects.toMatchObject({
      status: 422,
      problem: { code: 'BALANCE_LIMIT_EXCEEDED' },
    });
    expect(attempt.operation).toBeUndefined();
    expect((await c.api.wallet.get()).totalCents).toBe(17234);

    const accepted = attempt.submit({ amountCents: 1 });
    const operation = attempt.operation!;
    const result = await accepted;

    expect(result.data.wallet.totalCents).toBe(17235);
    expect(attempt.operation).toBeUndefined();

    const rejection = await attempt.submit({ amountCents: 1 }).catch((error: unknown) => error);

    expect(rejection).toMatchObject({ status: 429, retryAfterMs: expect.any(Number) });
    expect(errorMessage(rejection)).toContain('Muitas tentativas');
    expect(attempt.operation).toBeUndefined();

    const replay = await c.api.wallet.deposit(operation);

    expect(replay.data.depositId).toBe(result.data.depositId);
    expect(await entryCount()).toBe(4);
    await vi.waitFor(() =>
      expect(observedC.wallet.getCurrentResult().data?.totalCents).toBe(17235),
    );
  });
});

let participantE: Awaited<ReturnType<typeof person>>;
let participantF: Awaited<ReturnType<typeof person>>;
const receiptLots: AuctionDetail[] = [];
let publicReceipt: PublicReceipt;
const publicApi = resourceServices(new ApiClient(origin));

function observeParticipations(
  context: Awaited<ReturnType<typeof person>>,
  filter: 'all' | 'active' | 'won',
  limit = 1,
) {
  const observer = new InfiniteQueryObserver(context.cache, {
    ...participationOptions(context.id, filter, context.api.account, limit),
    refetchInterval: false,
  });
  const off = observer.subscribe(() => {});

  dispose.push(() => {
    off();
    observer.destroy();
  });
  context.manager.start();

  return observer;
}

describe('participation and receipt integration over HTTP and WebSocket', () => {
  let history: ReturnType<typeof observeParticipations>;
  let won: ReturnType<typeof observeParticipations>;
  let wallet: ReturnType<typeof observeWallet>;
  const items = () => history.getCurrentResult().data?.pages.flatMap((page) => page.items) ?? [];

  it('loads empty server filters, then connects the private participation channel', async () => {
    configure({ now: now + 720000, reconcileSettlements: false });
    participantE = await person('participation-e');
    participantF = await person('participation-f');
    await participantE.api.wallet.deposit(createOperation({ amountCents: 10000 }));
    await participantF.api.wallet.deposit(createOperation({ amountCents: 10000 }));
    for (let index = 0; index < 2; index++) {
      const result = await seller.api.auctions.create(
        createOperation({
          externalItemId: 'base1-58',
          startingPriceCents: 1000,
          minimumIncrementCents: 100,
          startsAt: new Date(now + 719000).toISOString(),
          endsAt: new Date(now + 1320000).toISOString(),
        }),
      );

      receiptLots.push(result.data as AuctionDetail);
    }

    history = observeParticipations(participantE, 'all');
    won = observeParticipations(participantE, 'won');
    wallet = observeWallet(participantE);
    await vi.waitFor(() => {
      expect(participantE.manager.getSnapshot().phase).toBe('ready');
      expect(history.getCurrentResult().isSuccess).toBe(true);
      expect(items()).toEqual([]);
      expect(won.getCurrentResult().data?.pages[0]?.items).toEqual([]);
    });
  });

  it('receives leading/outbid positions, filters and cursor pagination without manual refresh', async () => {
    await participantE.api.auctions.bid(receiptLots[0]!.id, createOperation({ amountCents: 1000 }));
    await participantF.api.auctions.bid(receiptLots[0]!.id, createOperation({ amountCents: 1100 }));
    await participantE.api.auctions.bid(receiptLots[1]!.id, createOperation({ amountCents: 1500 }));
    await vi.waitFor(() => expect(history.getCurrentResult().hasNextPage).toBe(true));
    await history.fetchNextPage();
    expect(
      items()
        .map((item) => item.state)
        .sort(),
    ).toEqual(['LEADING', 'OUTBID']);
    expect(items().find((item) => item.state === 'OUTBID')?.rank).toBe(2);
    expect(items().every((item) => !participationResult(item).receiptCode)).toBe(true);
    expect(won.getCurrentResult().data?.pages[0]?.items).toEqual([]);
    expect(
      (await participantE.api.account.participations({ filter: 'active' })).items,
    ).toHaveLength(2);
    expect(participantE.events).toContain('participation.updated');
  });

  it('isolates account/filter cursors and rejects anonymous and auctioneer access', async () => {
    const cursor = history.getCurrentResult().data!.pages[0]!.nextCursor!;

    await expect(
      participantF.api.account.participations({ filter: 'all', cursor }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      participantE.api.account.participations({ filter: 'won', cursor }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(publicApi.account.participations()).rejects.toMatchObject({ status: 401 });
    await expect(seller.api.account.participations()).rejects.toMatchObject({ status: 403 });
  });

  it('recovers participation changes missed during a disconnected transport', async () => {
    await vi.waitFor(() => expect(participantE.manager.getSnapshot().phase).toBe('ready'));

    const socket = participantE.sockets.at(-1)!;

    socket.io.reconnection(false);
    socket.io.engine.close();
    await vi.waitFor(() => expect(participantE.manager.getSnapshot().phase).toBe('disconnected'));
    await participantF.api.auctions.bid(receiptLots[1]!.id, createOperation({ amountCents: 1600 }));
    expect(items().some((item) => item.state === 'LEADING')).toBe(true);
    socket.io.reconnection(true);
    participantE.manager.retry();
    await vi.waitFor(() => expect(items().map((item) => item.state)).toEqual(['OUTBID', 'OUTBID']));
    await participantE.api.auctions.bid(receiptLots[1]!.id, createOperation({ amountCents: 1700 }));
    await vi.waitFor(() => expect(items().some((item) => item.state === 'LEADING')).toBe(true));
  });

  it('keeps the outcome pending and the reservation visible after the deadline until settlement', async () => {
    configure({ now: now + 1320001 });
    await history.refetch();
    await wallet.reservations.refetch();

    const pending = items().find((item) => item.auctionId === receiptLots[1]!.id)!;

    expect(pending.state).toBe('PROCESSING');
    expect(participationResult(pending).receiptCode).toBeNull();
    expect((await participantE.api.account.participations({ filter: 'won' })).items).toEqual([]);
    expect(
      wallet.reservations
        .getCurrentResult()
        .data?.pages.flatMap((page) => page.items)
        .some((item) => item.reservedForThisAuctionCents === 1700),
    ).toBe(true);
  });

  it('receives final WON/LOST and public receipt codes only after the real scheduler settles', async () => {
    configure({ reconcileSettlements: true });
    await vi.waitFor(
      () => {
        expect(
          items()
            .map((item) => item.state)
            .sort(),
        ).toEqual(['LOST', 'WON']);
        expect(won.getCurrentResult().data?.pages[0]?.items).toHaveLength(1);
      },
      { timeout: 10000, interval: 100 },
    );
    configure({ reconcileSettlements: false });

    const winner = items().find((item) => item.state === 'WON')!;
    const loser = items().find((item) => item.state === 'LOST')!;

    expect(participationResult(loser).receiptCode).toBeNull();
    expect(participationResult(winner).receiptCode).toMatch(/^[A-Za-z0-9_-]{32}$/);
    publicReceipt = await participantE.cache.fetchQuery(
      receiptOptions(winner.receiptCode!, publicApi.receipt),
    );
    expect(publicReceipt.amountCents).toBe(1700);
    expect(publicReceipt.winnerPseudonym).toBe(winner.myPseudonym);
    expect(publicReceipt.auctionId).toBe(receiptLots[1]!.id);
    expect(publicReceipt.finalAuditHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('serves the immutable receipt and stored artwork publicly while the upstream is offline', async () => {
    configure({ provider: 'offline' });

    const anonymous = await publicApi.receipt(publicReceipt.publicCode);
    const authenticated = await participantF.api.receipt(publicReceipt.publicCode);
    const picture = await fetch(mediaUrl(anonymous.imageUrl, origin));

    expect(anonymous).toEqual(publicReceipt);
    expect(authenticated).toEqual(anonymous);
    expect(picture.status).toBe(200);
    expect(picture.headers.get('Content-Type')).toContain('image/');
    expect((await picture.arrayBuffer()).byteLength).toBeGreaterThan(100);

    const serialized = JSON.stringify(anonymous);

    for (const secret of [
      participantE.id,
      participantF.id,
      participantE.credentials.email,
      participantF.credentials.email,
      'bidderId',
      'sellerId',
      'password',
      'accessToken',
    ]) {
      expect(serialized).not.toContain(secret);
    }

    expect(publicAuthHeaders).toEqual([]);
    configure({ provider: 'fixture' });
  });

  it('returns real not-found and temporary-unavailable receipt failures without a fabricated document', async () => {
    for (const code of ['invalid', 'x'.repeat(32)]) {
      await expect(publicApi.receipt(code)).rejects.toMatchObject({ status: 404 });
    }

    const stored = (
      await sql.query('SELECT "itemSnapshot" FROM "Receipt" WHERE "publicCode"=$1', [
        publicReceipt.publicCode,
      ])
    ).rows[0].itemSnapshot;

    try {
      await sql.query('UPDATE "Receipt" SET "itemSnapshot"=\'{}\'::jsonb WHERE "publicCode"=$1', [
        publicReceipt.publicCode,
      ]);
      await expect(publicApi.receipt(publicReceipt.publicCode)).rejects.toMatchObject({
        status: 503,
        problem: { code: 'RECEIPT_UNAVAILABLE' },
      });
    } finally {
      await sql.query('UPDATE "Receipt" SET "itemSnapshot"=$1::jsonb WHERE "publicCode"=$2', [
        JSON.stringify(stored),
        publicReceipt.publicCode,
      ]);
    }

    expect(await publicApi.receipt(publicReceipt.publicCode)).toEqual(publicReceipt);
  });
});
