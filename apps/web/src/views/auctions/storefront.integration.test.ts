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
  process.stdout.write(`Storefront: ${requests.length} real HTTP requests to NestJS/PostgreSQL.\n`);
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
