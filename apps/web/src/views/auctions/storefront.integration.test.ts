import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { InfiniteQueryObserver } from '@tanstack/react-query';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuctionDetail, CreateAuctionInput } from '@holobid/contracts';

import { createQueryClient } from '../../lib/query-client';
import { ApiClient } from '../../services/api-client';
import { authService } from '../../services/auth-service';
import { createOperation } from '../../services/operations';
import { resourceServices } from '../../services/resource-services';
import { PublicationAttempt } from '../create-auction/publication';
import { auctioneerSummaryOptions, ownedAuctionsOptions } from '../my-auctions/auctioneer-queries';

import { auctionCardData, auctionListOptions } from './auction-queries';

const origin = process.env.HOLOBID_WEB_API_URL!;
const client = new ApiClient(origin, `${origin}/api/v1/auth`);
const api = resourceServices(client);
const anonymous = resourceServices(new ApiClient(origin));
const auth = authService(client);
const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
const cache = createQueryClient();
const nativeFetch = globalThis.fetch;
const requests: number[] = [];
let losePublicationResponse = false;
const control = process.env.HOLOBID_HTTP_CONTROL!;
let token = '';
let now = 0;
const lots: AuctionDetail[] = [];
const configure = (patch: object) =>
  writeFileSync(
    control,
    JSON.stringify({ ...JSON.parse(readFileSync(control, 'utf8')), ...patch }),
  );

client.bindSession({ token: () => token, scope: () => 1, refresh: async () => null });

beforeAll(async () => {
  expect(process.env.HOLOBID_ISOLATED_DATABASE_TEST).toBe('1');
  expect(new URL(process.env.DATABASE_URL!).hostname).toBe('127.0.0.1');
  now = JSON.parse(readFileSync(control, 'utf8')).now;
  await sql.connect();
  vi.stubGlobal('fetch', async (url: string | URL, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);

    headers.set('Origin', process.env.HOLOBID_WEB_TEST_ORIGIN!);

    const response = await nativeFetch(url, { ...options, headers });

    requests.push(response.status);
    if (
      losePublicationResponse &&
      new URL(url).pathname === '/api/v1/auctions' &&
      options.method === 'POST' &&
      response.ok
    ) {
      losePublicationResponse = false;
      throw new TypeError('Test: response lost after server commit');
    }

    return response;
  });

  const credentials = { email: `store-${randomUUID()}@holobid.test`, password: 'Storefront-2026!' };
  const registered = await auth.register(credentials);

  await sql.query(`UPDATE "User" SET role='AUCTIONEER' WHERE id=$1`, [registered.user.id]);
  token = (await auth.login(credentials)).accessToken;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  cache.clear();
  await sql.end();
  process.stdout.write(
    `Storefront/publication: ${requests.length} real HTTP requests to NestJS/PostgreSQL.\n`,
  );
});

describe('public storefront over real HTTP', () => {
  it('returns an empty public storefront without authentication', async () => {
    expect((await anonymous.auctions.list()).items).toEqual([]);
  });
  it('publishes persisted lots and paginates with the frontend query options', async () => {
    for (let index = 0; index < 3; index++) {
      const input: CreateAuctionInput = {
        externalItemId: 'base1-58',
        startingPriceCents: 1000,
        minimumIncrementCents: 100,
        startsAt: new Date(now - 1000).toISOString(),
        endsAt: new Date(now + 3600000).toISOString(),
      };
      const result = await api.auctions.create(createOperation(input));

      expect(result.status).toBe(201);
      lots.push(result.data as AuctionDetail);
    }

    const observer = new InfiniteQueryObserver(
      cache,
      auctionListOptions('LIVE', anonymous.auctions, 2),
    );

    await observer.refetch();
    expect(observer.getCurrentResult().data?.pages[0]?.items).toHaveLength(2);
    expect(observer.getCurrentResult().hasNextPage).toBe(true);
    await observer.fetchNextPage();

    const ids = observer
      .getCurrentResult()
      .data?.pages.flatMap((page) => page.items.map((lot) => lot.id));

    expect(new Set(ids).size).toBe(3);
    expect(observer.getCurrentResult().hasNextPage).toBe(false);
    observer.destroy();
  });
  it('uses server time for scheduled → live → ended and hides cancelled lots', async () => {
    const result = await api.auctions.create(
      createOperation({
        externalItemId: 'base1-4',
        startingPriceCents: 2000,
        minimumIncrementCents: 50,
        startsAt: new Date(now + 60000).toISOString(),
        endsAt: new Date(now + 120000).toISOString(),
      }),
    );
    const lot = result.data as AuctionDetail;

    expect(
      (await anonymous.auctions.list({ status: 'SCHEDULED' })).items.map((item) => item.id),
    ).toContain(lot.id);
    configure({ now: now + 90000 });
    expect((await anonymous.auctions.list({ status: 'SCHEDULED' })).items).toHaveLength(0);
    expect(
      (await anonymous.auctions.list({ status: 'LIVE' })).items.map((item) => item.id),
    ).toContain(lot.id);
    configure({ now: now + 180000 });
    expect(
      (await anonymous.auctions.list({ status: 'ENDED' })).items.map((item) => item.id),
    ).toContain(lot.id);
    await api.auctions.cancel(lots[0]!.id, createOperation({}));
    for (const status of ['LIVE', 'SCHEDULED', 'ENDED'] as const) {
      expect(
        (await anonymous.auctions.list({ status })).items.map((item) => item.id),
      ).not.toContain(lots[0]!.id);
    }

    await expect(anonymous.auctions.detail(lots[0]!.id)).rejects.toMatchObject({ status: 404 });
  });
  it('loads public persisted details and image when TCGdex and its CDN are offline', async () => {
    configure({ provider: 'offline' });

    const detail = await anonymous.auctions.detail(lots[1]!.id);
    const image = await nativeFetch(auctionCardData(detail, origin).card.image);

    expect(detail.title).toBe('Pikachu');
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toContain('image/');
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(100);
    configure({ provider: 'fixture' });
  });
  it('keeps API failures explicit instead of replacing them with demo lots', async () => {
    await expect(anonymous.auctions.list({ cursor: 'invalid' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(anonymous.auctions.detail(randomUUID())).rejects.toMatchObject({ status: 404 });
  });
});

describe('card search and publication over real HTTP', () => {
  let sellerId = '';
  const storage = new Map<string, string>();
  const journal = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };
  const input = (): CreateAuctionInput => ({
    externalItemId: 'base1-58',
    startingPriceCents: 12345,
    minimumIncrementCents: 1,
    startsAt: new Date(now - 1000).toISOString(),
    endsAt: new Date(now + 3600000).toISOString(),
  });
  const count = async () =>
    (await sql.query('SELECT count(*)::int AS n FROM "Auction" WHERE "sellerId"=$1', [sellerId]))
      .rows[0].n;

  beforeAll(async () => {
    configure({ provider: 'fixture' });

    const credentials = {
      email: `publication-${randomUUID()}@holobid.test`,
      password: 'Publication-2026!',
    };
    const registered = await auth.register(credentials);

    sellerId = registered.user.id;
    await sql.query(`UPDATE "User" SET role='AUCTIONEER' WHERE id=$1`, [sellerId]);
    token = (await auth.login(credentials)).accessToken;
  });

  it('searches cards, loads selected details and handles empty search results', async () => {
    const page = await api.catalog.search({ q: 'Pikachu', limit: 12 });

    expect(page.items[0]?.externalId).toBe('base1-58');
    expect(await api.catalog.detail(page.items[0]!.externalId)).toMatchObject({
      title: 'Pikachu',
      setName: 'Base Set',
    });
    expect((await api.catalog.search({ q: 'empty-search' })).items).toEqual([]);
  });
  it('surfaces source errors, permits retry and preserves public lots', async () => {
    configure({ provider: 'offline' });
    await expect(api.catalog.search({ q: randomUUID() })).rejects.toMatchObject({
      status: 503,
      problem: { code: 'CATALOG_UNAVAILABLE' },
    });
    expect((await anonymous.auctions.list()).items.length).toBeGreaterThan(0);
    configure({ provider: 'fixture' });
    expect((await api.catalog.search({ q: 'Pikachu' })).items.length).toBeGreaterThan(0);
  });
  it('rejects publication when CDN is offline, preserves fields and allows a corrected retry', async () => {
    const before = await count();
    const attempt = new PublicationAttempt(api.auctions.create, journal, sellerId);

    configure({ provider: 'offline' });
    await expect(attempt.submit(input())).rejects.toMatchObject({
      status: 503,
      problem: { code: 'CATALOG_UNAVAILABLE' },
    });
    expect(attempt.operation).toBeUndefined();
    expect(await count()).toBe(before);
    configure({ provider: 'fixture' });
    expect((await attempt.submit(input())).data.confirmation).toBe('CONFIRMED');
    expect(await count()).toBe(before + 1);
  });
  it('rejects invalid publication values/dates through actual HTTP without creating rows', async () => {
    const before = await count();

    for (const patch of [
      { startingPriceCents: 0 },
      { minimumIncrementCents: -1 },
      { endsAt: new Date(now - 10000).toISOString() },
    ]) {
      await expect(
        api.auctions.create(createOperation({ ...input(), ...patch })),
      ).rejects.toMatchObject({ status: 400 });
    }

    expect(await count()).toBe(before);
  });
  it('coalesces double submit and confirms one persisted lot', async () => {
    const before = await count();
    const attempt = new PublicationAttempt(api.auctions.create, journal, sellerId);
    const first = attempt.submit(input());
    const second = attempt.submit(input());

    expect(first).toBe(second);

    const result = await first;

    expect(result.status).toBe(201);
    expect(result.data.confirmation).toBe('CONFIRMED');
    expect(await count()).toBe(before + 1);
    expect(attempt.operation).toBeUndefined();
  });
  it('recovers an actually committed publication after a lost response and reload', async () => {
    const before = await count();
    const attempt = new PublicationAttempt(api.auctions.create, journal, sellerId);

    losePublicationResponse = true;
    await expect(attempt.submit(input())).rejects.toMatchObject({ kind: 'network' });
    expect(await count()).toBe(before + 1);

    const original = attempt.operation;
    const restored = new PublicationAttempt(api.auctions.create, journal, sellerId);

    expect(restored.operation).toEqual(original);
    expect((await restored.submit()).data.confirmation).toBe('CONFIRMED');
    expect(await count()).toBe(before + 1);
    expect(restored.operation).toBeUndefined();
  });
  it('recovers genuine 202 audit confirmation using the same operation while provider is offline', async () => {
    const before = await count();
    const attempt = new PublicationAttempt(api.auctions.create, journal, sellerId);

    configure({ pendingPublication: true });

    const pending = await attempt.submit(input());

    expect(pending.status).toBe(202);
    expect(pending.data.confirmation).toBe('PENDING');

    const restored = new PublicationAttempt(api.auctions.create, journal, sellerId);

    configure({ pendingPublication: false, provider: 'offline' });

    const confirmed = await restored.submit();

    expect(confirmed.status).toBe(201);
    expect((confirmed.data as AuctionDetail).id).toBe(
      'auctionId' in pending.data ? pending.data.auctionId : 'missing',
    );
    expect(await count()).toBe(before + 1);
    configure({ provider: 'fixture' });
  });
  it('denies catalog and publishing to a bidder through actual HTTP', async () => {
    const sellerToken = token;
    const bidder = await auth.register({
      email: `bidder-${randomUUID()}@holobid.test`,
      password: 'Publication-2026!',
    });

    token = bidder.accessToken;
    try {
      await expect(api.catalog.search()).rejects.toMatchObject({ status: 403 });
      await expect(api.auctions.create(createOperation(input()))).rejects.toMatchObject({
        status: 403,
      });
    } finally {
      token = sellerToken;
    }
  });
});

describe('auctioneer management over real HTTP', () => {
  let sellerId = '';
  let sellerToken = '';
  let bidderToken = '';
  let otherToken = '';
  const owned: AuctionDetail[] = [];

  beforeAll(async () => {
    now = JSON.parse(readFileSync(control, 'utf8')).now;
    for (const role of ['owner', 'other', 'bidder']) {
      const credentials = {
        email: `${role}-${randomUUID()}@holobid.test`,
        password: 'Management-2026!',
      };
      const registered = await auth.register(credentials);

      if (role !== 'bidder') {
        await sql.query(`UPDATE "User" SET role='AUCTIONEER' WHERE id=$1`, [registered.user.id]);
      }

      const session = await auth.login(credentials);

      if (role === 'owner') {
        sellerId = registered.user.id;
        sellerToken = session.accessToken;
      } else if (role === 'other') {
        otherToken = session.accessToken;
      } else {
        bidderToken = session.accessToken;
      }
    }

    token = sellerToken;
    for (let i = 0; i < 3; i++) {
      const result = await api.auctions.create(
        createOperation({
          externalItemId: 'base1-58',
          startingPriceCents: 1000,
          minimumIncrementCents: 100,
          startsAt: new Date(now - 1000).toISOString(),
          endsAt: new Date(now + 600000).toISOString(),
        }),
      );

      owned.push(result.data as AuctionDetail);
    }
  });

  it('paginates only the signed-in seller lots and gets server totals independently of pages', async () => {
    const observer = new InfiniteQueryObserver(
      cache,
      ownedAuctionsOptions(sellerId, undefined, api.account, 2),
    );

    await observer.refetch();
    expect(observer.getCurrentResult().data?.pages[0]?.items).toHaveLength(2);
    await observer.fetchNextPage();
    expect(
      new Set(
        observer
          .getCurrentResult()
          .data?.pages.flatMap((page) => page.items.map((item) => item.id)),
      ),
    ).toEqual(new Set(owned.map((item) => item.id)));
    expect(
      (await cache.fetchQuery(auctioneerSummaryOptions(sellerId, api.account))).totalReceivedCents,
    ).toBe(0);
    observer.destroy();
  });
  it('isolates another auctioneer and denies a bidder and a visitor', async () => {
    token = otherToken;
    expect((await api.account.auctions()).items).toEqual([]);
    await expect(api.auctions.cancel(owned[0]!.id, createOperation({}))).rejects.toMatchObject({
      status: 404,
    });
    token = bidderToken;
    await expect(api.account.auctions()).rejects.toMatchObject({ status: 403 });
    await expect(api.account.summary()).rejects.toMatchObject({ status: 403 });
    await expect(api.auctions.cancel(owned[0]!.id, createOperation({}))).rejects.toMatchObject({
      status: 403,
    });
    await expect(anonymous.account.auctions()).rejects.toMatchObject({ status: 401 });
    token = sellerToken;
  });
  it('cancels once, replays the same request, preserves owner history and hides public details', async () => {
    const operation = createOperation({});
    const first = await api.auctions.cancel(owned[0]!.id, operation);
    const replay = await api.auctions.cancel(owned[0]!.id, operation);

    expect(first.data).toMatchObject({
      status: 'CANCELLED',
      canCancel: false,
      cancelReason: 'AUCTION_CANCELLED',
    });
    expect(replay.data).toEqual(first.data);
    expect(
      (await api.account.auctions({ status: 'CANCELLED' })).items.map((item) => item.id),
    ).toEqual([owned[0]!.id]);
    await expect(anonymous.auctions.detail(owned[0]!.id)).rejects.toMatchObject({ status: 404 });
  });
  it('rejects cancellation when a real bid arrived after loading the dashboard', async () => {
    expect(
      (await api.account.auctions({ status: 'LIVE' })).items.find(
        (item) => item.id === owned[1]!.id,
      )?.canCancel,
    ).toBe(true);
    token = bidderToken;
    await api.wallet.deposit(createOperation({ amountCents: 10000 }));
    await api.auctions.bid(owned[1]!.id, createOperation({ amountCents: 1000 }));
    token = sellerToken;
    await expect(api.auctions.cancel(owned[1]!.id, createOperation({}))).rejects.toMatchObject({
      status: 409,
      problem: { code: 'AUCTION_HAS_BIDS' },
    });
    expect(
      (await api.account.auctions({ status: 'LIVE' })).items.find(
        (item) => item.id === owned[1]!.id,
      ),
    ).toMatchObject({ canCancel: false, cancelReason: 'AUCTION_HAS_BIDS' });
    expect((await api.account.summary()).totalReceivedCents).toBe(0);
  });
  it('shows settled revenue and no-winner outcomes from actual settlement and preserves ended lots', async () => {
    configure({ now: now + 600001, reconcileSettlements: true });
    await vi.waitFor(
      async () => {
        expect((await api.account.summary()).settledCount).toBe(1);
      },
      { timeout: 5000, interval: 200 },
    );

    const summary = await api.account.summary();
    const ended = (await api.account.auctions({ status: 'ENDED' })).items;

    expect(summary).toMatchObject({
      totalReceivedCents: 1000,
      settledCount: 1,
      withoutWinnerCount: 1,
      wallet: { totalCents: 1000, reservedCents: 0 },
    });
    expect(ended.find((item) => item.id === owned[1]!.id)?.outcome).toMatchObject({
      kind: 'SOLD',
      amountCents: 1000,
    });
    expect(ended.find((item) => item.id === owned[2]!.id)?.outcome).toEqual({
      kind: 'NO_BIDS',
      amountCents: 0,
    });
    await expect(api.auctions.cancel(owned[2]!.id, createOperation({}))).rejects.toMatchObject({
      status: 409,
      problem: { code: 'AUCTION_ENDED' },
    });
    token = otherToken;
    expect((await api.account.summary()).totalReceivedCents).toBe(0);
    token = sellerToken;
    configure({ reconcileSettlements: false });
  });
});
