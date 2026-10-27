import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { clearPrivateQueries, createQueryClient, queryKeys } from '../lib/query-client';

import { ApiClient, apiOrigin } from './api-client';
import { ApiRequestError, errorMessage } from './api-error';
import { authService } from './auth-service';
import { createOperation } from './operations';
import { resourceServices } from './resource-services';

type Recorded = { path: string; body: string; headers: IncomingMessage['headers'] };

const records: Recorded[] = [];
let handler: (request: IncomingMessage, response: ServerResponse) => void;
let client: ApiClient;
let origin: string;
const server = createServer(async (request, response) => {
  let body = '';

  for await (const chunk of request) {
    body += chunk;
  }

  records.push({ path: request.url!, body, headers: request.headers });
  handler(request, response);
});

function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(data));
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  records.length = 0;
  client = new ApiClient(origin, `${origin}/api/v1/auth`);
  handler = (_request, response) => json(response, 200, { ok: true });
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('HTTP transport over a real TCP server', () => {
  it('normalizes the API prefix and rejects external request paths', async () => {
    expect(apiOrigin(`${origin}/api/v1/`)).toBe(origin);
    expect(() => apiOrigin(`${origin}/other`)).toThrow();
    await expect(client.request('//other.test/secret')).rejects.toThrow();
    await client.request('/auctions');
    expect(records[0]?.path).toBe('/api/v1/auctions');
  });

  it('sends JSON and CSRF protection and accepts an empty logout response', async () => {
    handler = (_request, response) => {
      response.writeHead(204);
      response.end();
    };

    await authService(client).logout('access-token');
    expect(records[0]).toMatchObject({
      path: '/api/v1/auth/logout',
      body: '{}',
      headers: {
        'x-csrf-protection': '1',
        'content-type': 'application/json',
        authorization: 'Bearer access-token',
      },
    });
  });

  it.each([400, 401, 403, 409, 422, 429, 503])(
    'preserves a structured %i error without retrying a POST',
    async (status) => {
      handler = (_request, response) =>
        json(response, status, {
          code: 'TEST_FAILURE',
          message: 'Internal diagnostic',
          requestId: 'request-123',
          details: { fieldErrors: { email: ['Invalid'] } },
        });
      await expect(
        client.request('/wallet/deposits', { method: 'POST', body: {} }),
      ).rejects.toMatchObject({
        kind: 'http',
        status,
        problem: { requestId: 'request-123', details: { fieldErrors: { email: ['Invalid'] } } },
      });
      expect(records).toHaveLength(1);
    },
  );

  it('handles a proxy HTML error without displaying its content', async () => {
    handler = (_request, response) => {
      response.writeHead(502);
      response.end('<html>private upstream</html>');
    };

    const error = await client.request('/auctions').catch((value: unknown) => value);

    expect(error).toMatchObject({ status: 502, kind: 'http' });
    expect(errorMessage(error)).not.toContain('private upstream');
  });

  it('distinguishes a timeout, deliberate cancellation and malformed success JSON', async () => {
    handler = () => {};

    await expect(client.request('/slow', { timeoutMs: 30 })).rejects.toMatchObject({
      kind: 'timeout',
    });

    const cancel = new AbortController();
    const request = client.request('/slow', { signal: cancel.signal });

    cancel.abort();
    await expect(request).rejects.toMatchObject({ kind: 'aborted' });
    handler = (_request, response) => {
      response.end('not json');
    };

    await expect(client.request('/invalid')).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('retains the operation key and original body after a lost response and PENDING', async () => {
    const input = { amountCents: 500 };
    const operation = createOperation(input);
    const api = resourceServices(client);

    input.amountCents = 900;
    handler = (request) => request.socket.destroy();
    await expect(api.auctions.bid('auction', operation)).rejects.toMatchObject({ kind: 'network' });
    expect(records).toHaveLength(1);
    handler = (_request, response) =>
      json(response, 202, {
        confirmation: 'PENDING',
        operationId: operation.key,
        auctionId: 'auction',
      });

    const result = await api.auctions.bid('auction', operation);

    expect(result.status).toBe(202);
    expect(result.data.confirmation).toBe('PENDING');
    expect(records[1]?.body).toBe(records[0]?.body);
    expect(records[1]?.headers['idempotency-key']).toBe(operation.key);
    expect(JSON.parse(records[1]!.body)).toEqual({ amountCents: 500 });
  });

  it('renews once on 401 and preserves the mutation intent on its single replay', async () => {
    let renewals = 0;

    client.bindSession({
      token: () => 'expired',
      scope: () => 0,
      refresh: async () => {
        renewals++;

        return 'fresh';
      },
    });
    handler = (request, response) =>
      json(response, request.headers.authorization === 'Bearer fresh' ? 200 : 401, {});

    const operation = createOperation({ amountCents: 500 });

    await resourceServices(client).wallet.deposit(operation);
    expect(renewals).toBe(1);
    expect(records).toHaveLength(2);
    expect(records[1]?.body).toBe(records[0]?.body);
    expect(records[1]?.headers['idempotency-key']).toBe(operation.key);
    handler = (_request, response) => json(response, 401, {});
    await expect(client.request('/wallet', { authenticated: true })).rejects.toMatchObject({
      status: 401,
    });
    expect(records).toHaveLength(4);
  });

  it('retries transient GETs at most twice and clears private cache without touching public data', async () => {
    const cache = createQueryClient();

    handler = (_request, response) => json(response, 503, {});
    await expect(
      cache.fetchQuery({ queryKey: ['outage'], queryFn: () => client.request('/auctions') }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(records).toHaveLength(3);
    cache.setQueryData(queryKeys.private('a', 'wallet'), { totalCents: 500 });
    cache.setQueryData(queryKeys.private('b', 'wallet'), { totalCents: 0 });
    cache.setQueryData(queryKeys.auctions(), []);
    clearPrivateQueries(cache);
    expect(cache.getQueryData(queryKeys.private('a', 'wallet'))).toBeUndefined();
    expect(cache.getQueryData(queryKeys.private('b', 'wallet'))).toBeUndefined();
    expect(cache.getQueryData(queryKeys.auctions())).toEqual([]);
    cache.clear();
  });

  it('honors Retry-After and avoids an automatic long rate-limit wait', async () => {
    handler = (_request, response) => {
      response.setHeader('Retry-After', '60');
      json(response, 429, {});
    };

    const cache = createQueryClient();

    await expect(
      cache.fetchQuery({ queryKey: ['limited'], queryFn: () => client.request('/auctions') }),
    ).rejects.toMatchObject({ retryAfterMs: 60_000 });
    expect(records).toHaveLength(1);
    cache.clear();
  });
});
