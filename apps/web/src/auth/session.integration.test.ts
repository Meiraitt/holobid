import { createHmac, randomUUID } from 'node:crypto';
import process from 'node:process';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { clearPrivateQueries, createQueryClient, queryKeys } from '../lib/query-client';
import { ApiClient } from '../services/api-client';
import { authService } from '../services/auth-service';
import { resourceServices } from '../services/resource-services';

import { safeDestination } from './navigation';
import { SessionController, type SessionCoordinator } from './session-controller';

const origin = process.env.HOLOBID_AUTH_API_URL!;
const nativeFetch = globalThis.fetch;
const requests: { path: string; status: number }[] = [];
const cache = createQueryClient();
let cookie = '';
let cookieOptions = '';
let signedOut = false;
let queue = Promise.resolve();
let releaseRefresh: (() => void) | null = null;
let refreshReceived: (() => void) | null = null;
const coordination: SessionCoordinator = {
  exclusive: <T>(work: () => Promise<T>) => {
    const task = queue.then(work, work);

    queue = task.then(
      () => {},
      () => {},
    );

    return task;
  },
  signedOut: () => signedOut,
  publish: (state) => {
    signedOut = state === 'signed-out';
  },
  subscribe: () => () => {},
};
const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
const client = new ApiClient(origin, `${origin}/api/v1/auth`);
const api = authService(client);
const resources = resourceServices(client);
const session = new SessionController(api, coordination, () => clearPrivateQueries(cache));
const credentials = {
  email: `auth-${randomUUID()}@holobid.test`,
  password: 'Integrated-auth-2026!',
};

client.bindSession(session);

beforeAll(async () => {
  expect(process.env.HOLOBID_ISOLATED_DATABASE_TEST).toBe('1');
  expect(new URL(process.env.DATABASE_URL!).hostname).toBe('127.0.0.1');
  await sql.connect();
  vi.stubGlobal('fetch', async (url: string | URL, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    const isAuth = String(url).includes('/api/v1/auth/');

    if (isAuth) {
      expect(options.credentials).toBe('include');
      headers.set('Origin', 'http://127.0.0.1:5173');
      if (cookie) {
        headers.set('Cookie', cookie);
      }
    }

    const response = await nativeFetch(url, { ...options, headers });
    const setCookie = response.headers.get('set-cookie');

    if (setCookie) {
      cookie = setCookie.split(';')[0]!;
      cookieOptions = setCookie.slice(cookie.length);
    }

    requests.push({ path: new URL(url).pathname, status: response.status });
    if (String(url).endsWith('/auth/refresh') && refreshReceived) {
      const received = refreshReceived;

      refreshReceived = null;
      await new Promise<void>((resolve) => {
        releaseRefresh = resolve;
        received();
      });
    }

    return response;
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  cache.clear();
  await sql.end();
  process.stdout.write(
    `Integrated auth: ${requests.length} real HTTP requests to NestJS and isolated PostgreSQL.\n`,
  );
});

describe('real frontend services + session + NestJS + PostgreSQL', () => {
  it('restores an absent cookie as anonymous', async () => {
    await session.restore();
    expect(session.getSnapshot().status).toBe('anonymous');
  });

  it('registers a bidder with a zero wallet and an HttpOnly, SameSite Strict auth cookie', async () => {
    const user = await session.signIn('register', credentials);

    expect(user.role).toBe('BIDDER');
    expect(cookieOptions).toMatch(/HttpOnly/i);
    expect(cookieOptions).toMatch(/SameSite=Strict/i);
    expect(cookieOptions).toMatch(/Path=\/api\/v1\/auth/);
    expect(await api.me()).toEqual(user);
    expect(await resources.wallet.get()).toMatchObject({
      totalCents: 0,
      availableCents: 0,
      reservedCents: 0,
    });

    const stored = await sql.query('SELECT "passwordHash" FROM "User" WHERE id=$1', [user.id]);

    expect(stored.rows[0].passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects duplicates, invalid credentials and invalid registration without fake success', async () => {
    await expect(api.register(credentials)).rejects.toMatchObject({
      status: 409,
      problem: { code: 'EMAIL_ALREADY_EXISTS' },
    });
    await expect(
      api.login({ ...credentials, password: 'Wrong-password-2026!' }),
    ).rejects.toMatchObject({ status: 401, problem: { code: 'INVALID_CREDENTIALS' } });
    await expect(api.register({ email: 'invalid', password: 'short' })).rejects.toMatchObject({
      status: 400,
    });
    expect(session.getSnapshot().user?.email).toBe(credentials.email);
  });

  it('restores a new page session and serializes refreshes from two contexts', async () => {
    const second = new SessionController(api, coordination, () => {});

    await Promise.all([session.refresh(session.token()), second.restore()]);
    expect(second.getSnapshot().user).toEqual(session.getSnapshot().user);

    const rotations = await sql.query(
      'SELECT "rotationVersion" FROM "AuthSession" WHERE "userId"=$1',
      [session.getSnapshot().user!.id],
    );

    expect(rotations.rows[0].rotationVersion).toBe(2);

    const before = requests.length;

    await Promise.all(Array.from({ length: 8 }, () => session.refresh(session.token())));
    expect(
      requests.slice(before).filter((request) => request.path.endsWith('/refresh')),
    ).toHaveLength(1);
  });

  it('renews a real expired JWT once for concurrent private requests', async () => {
    const parts = session.token()!.split('.');
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    const payload = Buffer.from(
      JSON.stringify({
        ...claims,
        iat: Math.floor(Date.now() / 1000) - 910,
        exp: Math.floor(Date.now() / 1000) - 10,
      }),
    ).toString('base64url');
    const unsigned = `${parts[0]}.${payload}`;
    const expired = `${unsigned}.${createHmac('sha256', Buffer.from(process.env.JWT_SECRET!, 'base64url')).update(unsigned).digest('base64url')}`;
    let token = expired;
    const previousToken = session.token();

    client.bindSession({
      token: () => token,
      scope: session.scope,
      refresh: async () => {
        token = (await session.refresh(previousToken))!;

        return token;
      },
    });

    const before = requests.length;

    await Promise.all([resources.wallet.get(), resources.wallet.get(), api.me()]);
    expect(requests.slice(before).filter((request) => request.status === 401)).toHaveLength(3);
    expect(
      requests.slice(before).filter((request) => request.path.endsWith('/refresh')),
    ).toHaveLength(1);
    client.bindSession(session);
  });

  it('logs out during a delayed refresh without restoring the old session and revokes its JWT', async () => {
    const oldToken = session.token()!;
    const arrived = new Promise<void>((resolve) => {
      refreshReceived = resolve;
    });
    const renewal = session.refresh(oldToken);

    await arrived;
    cache.setQueryData(queryKeys.private(session.getSnapshot().user!.id, 'wallet'), {
      totalCents: 123,
    });

    const logout = session.logout();

    expect(session.getSnapshot().status).toBe('anonymous');
    expect(cache.getQueryCache().findAll({ queryKey: ['private'] })).toHaveLength(0);
    releaseRefresh!();
    await Promise.all([renewal, logout]);
    expect(session.token()).toBeNull();
    await expect(client.request('/auth/me', { bearer: oldToken })).rejects.toMatchObject({
      status: 401,
    });

    const before = requests.length;

    await session.restore();
    expect(requests).toHaveLength(before);
  });

  it('logs in again and expires an actually revoked session', async () => {
    await session.signIn('login', credentials);
    await sql.query('UPDATE "AuthSession" SET "revokedAt"=now() WHERE "userId"=$1', [
      session.getSnapshot().user!.id,
    ]);
    await expect(resources.wallet.get()).rejects.toMatchObject({ status: 401 });
    expect(session.getSnapshot().status).toBe('anonymous');
    expect(session.token()).toBeNull();
  });

  it('switches accounts without retaining private data and derives auctioneer permissions from the server', async () => {
    cache.setQueryData(queryKeys.private('old-user', 'wallet'), { totalCents: 999 });

    const seller = { ...credentials, email: `seller-${randomUUID()}@holobid.test` };
    const bidder = await api.register(seller);

    await sql.query('UPDATE "User" SET role=$1 WHERE id=$2', ['AUCTIONEER', bidder.user.id]);
    await session.signIn('login', seller);
    expect(session.getSnapshot().user?.role).toBe('AUCTIONEER');
    expect(cache.getQueryData(queryKeys.private('old-user', 'wallet'))).toBeUndefined();
    expect(await resources.account.summary()).toMatchObject({ totalReceivedCents: 0 });
    expect(safeDestination(null, 'AUCTIONEER')).toBe('/my-auctions');
    await expect(resources.account.participations()).rejects.toMatchObject({ status: 403 });
    await session.logout();
  });
});
