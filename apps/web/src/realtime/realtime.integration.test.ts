import { Buffer } from 'node:buffer';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { QueryObserver } from '@tanstack/react-query';
import pg from 'pg';
import { io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuctionDetail, AuthResponse, CredentialsInput } from '@holobid/contracts';

import { SessionController } from '../auth/session-controller';
import { clearPrivateQueries, createQueryClient, queryKeys } from '../lib/query-client';
import { ApiClient } from '../services/api-client';
import { createOperation } from '../services/operations';
import { resourceServices } from '../services/resource-services';
import { myBidOptions, roomOptions } from '../views/auction-room/room-queries';

import { RealtimeClient } from './realtime-client';

const origin = process.env.HOLOBID_WEB_API_URL!;
const webOrigin = process.env.HOLOBID_WEB_TEST_ORIGIN!;
const control = process.env.HOLOBID_HTTP_CONTROL!;
const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
const nativeFetch = globalThis.fetch;
let httpRequests = 0;
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

    const response = await nativeFetch(url, { ...options, headers });

    httpRequests++;

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
