import { QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../lib/query-client';
import { ApiRequestError } from '../services/api-error';

import { EventGate } from './event-gate';
import { RealtimeClient } from './realtime-client';

// Test transport intentionally accepts the different event/ACK argument shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => void;

class FakeSocket {
  connected = false;

  listeners = new Map<string, Set<Handler>>();

  sent: string[] = [];

  on(name: string, handler: Handler) {
    const handlers = this.listeners.get(name) ?? new Set();

    handlers.add(handler);
    this.listeners.set(name, handlers);

    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  receive(name: string, ...args: any[]) {
    for (const handler of this.listeners.get(name) ?? []) {
      handler(...args);
    }
  }

  removeAllListeners() {
    this.listeners.clear();
  }

  connect() {
    this.connected = true;
    this.receive('connect');

    return this;
  }

  disconnect() {
    this.connected = false;
    this.receive('disconnect', 'io client disconnect');

    return this;
  }

  timeout() {
    return this;
  }

  emit(name: string, _input: unknown, ack: Handler) {
    this.sent.push(name);
    ack(null, { ok: true, auctionVersion: 0, serverTime: new Date().toISOString() });

    return this;
  }
}

function fixture() {
  let token: string | null = 'a-token';
  let user = { id: 'a', email: 'a@test', role: 'BIDDER' as const };
  let notify = () => {};

  const session = {
    getSnapshot: () => ({ status: 'authenticated' as const, user, expiresAt: 9999999999999 }),
    subscribe: (callback: () => void) => {
      notify = callback;

      return () => {
        notify = () => {};
      };
    },
    token: () => token,
    refresh: vi.fn(async () => {
      token = 'renewed';
      notify();

      return token;
    }),
    revoke: vi.fn(() => {
      token = null;
      notify();
    }),
  };
  const sockets: FakeSocket[] = [];
  const cache = createQueryClient();
  const manager = new RealtimeClient(cache, session, () => {
    const socket = new FakeSocket();

    sockets.push(socket);

    return socket as unknown as ReturnType<ConstructorParameters<typeof RealtimeClient>[2]>;
  });

  return {
    manager,
    cache,
    session,
    sockets,
    changeAccount: () => {
      user = { ...user, id: 'b' };
      token = 'b-token';
      notify();
    },
  };
}

describe('realtime lifecycle and deduplication', () => {
  it.each(['dashboard', 'room'])(
    'paints the first %s response, then verifies fresh snapshots before readiness',
    async (view) => {
      const f = fixture();
      let first!: (value: { auction: { version: number } }) => void;
      let fresh!: (value: { auction: { version: number } }) => void;
      const initialResponse = new Promise<{ auction: { version: number } }>((resolve) => {
        first = resolve;
      });
      const freshResponse = new Promise<{ auction: { version: number } }>((resolve) => {
        fresh = resolve;
      });
      const aborted = vi.fn();
      const read = vi.fn(({ signal }: { signal: AbortSignal }) => {
        signal.addEventListener('abort', aborted);

        return read.mock.calls.length === 1
          ? initialResponse
          : read.mock.calls.length === 2
            ? freshResponse
            : Promise.resolve({ auction: { version: 3 } });
      });
      const observer = new QueryObserver(f.cache, {
        queryKey:
          view === 'room'
            ? ['public', 'room', 'lot']
            : ['private', 'a', 'owned-auctions', { limit: 12 }],
        queryFn: read,
        retry: false,
      });
      const off = observer.subscribe(() => {});

      const unwatch = view === 'room' ? f.manager.watchAuction('lot') : () => {};

      try {
        f.manager.start();
        // Allow the socket's event coalescing window to pass while the initial GET is pending.
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(aborted).not.toHaveBeenCalled();
        expect(read).toHaveBeenCalledTimes(1);
        first({ auction: { version: 1 } });
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
        expect(observer.getCurrentResult().data).toEqual({ auction: { version: 1 } });
        expect(f.manager.getSnapshot().phase).toBe('syncing');
        f.sockets[0]!.receive(view === 'room' ? 'auction.updated' : 'catalog.updated', {
          eventId: 'during-read',
          auctionId: 'lot',
          auctionVersion: 2,
        });
        fresh({ auction: { version: 2 } });
        await vi.waitFor(() => expect(f.manager.getSnapshot().phase).toBe('ready'));
        expect(read).toHaveBeenCalledTimes(3);
        expect(observer.getCurrentResult().data).toEqual({ auction: { version: 3 } });
      } finally {
        unwatch();
        off();
        observer.destroy();
        f.manager.stop();
        f.cache.clear();
      }
    },
  );

  it.each(['dashboard', 'room'])(
    'does not declare the %s synchronized when post-subscription verification fails',
    async (view) => {
      const f = fixture();
      let finish!: (value: { auction: { version: number } }) => void;
      const initialResponse = new Promise<{ auction: { version: number } }>((resolve) => {
        finish = resolve;
      });
      const read = vi
        .fn()
        .mockImplementationOnce(() => initialResponse)
        .mockRejectedValue(new ApiRequestError('http', 503));
      const observer = new QueryObserver(f.cache, {
        queryKey:
          view === 'room'
            ? ['public', 'room', 'lot']
            : ['private', 'a', 'owned-auctions', { limit: 12 }],
        queryFn: read,
        retry: false,
      });
      const off = observer.subscribe(() => {});

      const unwatch = view === 'room' ? f.manager.watchAuction('lot') : () => {};

      try {
        f.manager.start();
        await new Promise((resolve) => setTimeout(resolve, 60));
        finish({ auction: { version: 1 } });
        await vi.waitFor(() => expect(f.manager.getSnapshot().phase).toBe('unavailable'));
        expect(observer.getCurrentResult().data).toEqual({ auction: { version: 1 } });
        expect(read).toHaveBeenCalledTimes(2);
      } finally {
        unwatch();
        off();
        observer.destroy();
        f.manager.stop();
        f.cache.clear();
      }
    },
  );

  it('ignores duplicate/old versions and bounds the event history', () => {
    const gate = new EventGate();

    expect(gate.accept('a', 'lot', 2)).toBe(true);
    expect(gate.accept('a', 'lot', 3)).toBe(false);
    expect(gate.accept('b', 'lot', 1)).toBe(false);
    expect(gate.accept('c', 'lot', 3, 4)).toBe(false);
    expect(gate.accept('d', 'lot', 5, 4)).toBe(true);
    for (let i = 0; i < 600; i++) {
      gate.accept(String(i), String(i), i);
    }

    expect(gate.accept('a', 'other', 1)).toBe(true);
  });
  it('shares a room subscription and cleans up under a StrictMode start/stop/start cycle', async () => {
    const f = fixture();
    const unwatch = f.manager.watchAuction('lot');
    const unwatchAgain = f.manager.watchAuction('lot');

    f.manager.start();
    await vi.waitFor(() => expect(f.manager.getSnapshot().phase).toBe('ready'));
    expect(f.sockets[0]!.sent.filter((name) => name === 'auction.subscribe')).toHaveLength(1);
    unwatch();
    expect(f.sockets[0]!.sent).not.toContain('auction.unsubscribe');
    unwatchAgain();
    expect(f.sockets[0]!.sent.filter((name) => name === 'auction.unsubscribe')).toHaveLength(1);
    f.manager.stop();
    expect(f.sockets[0]!.listeners.size).toBe(0);
    f.manager.start();
    expect(f.sockets).toHaveLength(2);
    expect(f.sockets[1]!.listeners.get('wallet.updated')?.size).toBe(1);
    f.manager.stop();
    f.cache.clear();
  });
  it('ignores callbacks from a replaced account socket and renews an expired token only once', async () => {
    const f = fixture();
    const invalidate = vi.spyOn(f.cache, 'invalidateQueries');

    f.manager.start();
    await vi.waitFor(() => expect(f.manager.getSnapshot().phase).toBe('ready'));

    const old = f.sockets[0]!;
    const callback = [...old.listeners.get('wallet.updated')!][0]!;

    f.changeAccount();
    await vi.waitFor(() => expect(f.manager.getSnapshot().phase).toBe('ready'));
    invalidate.mockClear();
    callback({ eventId: 'late', walletVersion: 99 });
    expect(invalidate).not.toHaveBeenCalled();
    expect(old.listeners.size).toBe(0);

    const current = f.sockets[1]!;
    const expire = [...current.listeners.get('auth.expired')!][0]!;

    expire();
    expire();
    await vi.waitFor(() => expect(f.sockets).toHaveLength(3));
    expect(f.session.refresh).toHaveBeenCalledTimes(1);
    f.sockets[2]!.receive('session.revoked');
    expect(f.session.revoke).toHaveBeenCalledTimes(1);
    f.manager.stop();
    f.cache.clear();
  });
  it('keeps synchronization blocked on failed HTTP refresh and recovers on retry', async () => {
    const f = fixture();
    const query = vi.fn(async () => ({ version: 1 }));
    const observer = new QueryObserver(f.cache, {
      queryKey: ['private', 'a', 'wallet', {}],
      queryFn: query,
      retry: false,
    });
    const off = observer.subscribe(() => {});

    await observer.refetch();
    query.mockRejectedValue(new Error('offline'));
    f.manager.start();
    await vi.waitFor(() => expect(f.manager.getSnapshot().phase).toBe('unavailable'));
    query.mockResolvedValue({ version: 2 });
    f.manager.retry();
    await vi.waitFor(() => expect(f.manager.getSnapshot().phase).toBe('ready'));
    expect(observer.getCurrentResult().data?.version).toBe(2);
    off();
    observer.destroy();
    f.manager.stop();
    f.cache.clear();
  });
  it.each([
    { key: ['public', 'room', 'missing'], status: 404 },
    { key: ['public', 'auction', 'cancelled'], status: 404 },
    { key: ['public', 'audit', 'missing'], status: 404 },
    { key: ['public', 'audit', 'invalid'], status: 400 },
    { key: ['public', 'receipt', 'missing'], status: 404 },
    { key: ['private', 'a', 'auction-position', { id: 'cancelled' }], status: 404 },
    { key: ['private', 'a', 'catalog', {}], status: 503 },
    { key: ['private', 'a', 'catalog-item', {}], status: 503 },
  ])(
    'keeps $key errors local without masking a simultaneous wallet failure',
    async ({ key, status }) => {
      const f = fixture();
      const resource = new QueryObserver(f.cache, {
        queryKey: key,
        queryFn: async () => {
          throw new ApiRequestError('http', status);
        },
        retry: false,
      });
      const walletQuery = vi.fn(async () => ({ version: 1 }));
      const wallet = new QueryObserver(f.cache, {
        queryKey: ['private', 'a', 'wallet', {}],
        queryFn: walletQuery,
        retry: false,
      });
      const offResource = resource.subscribe(() => {});
      const offWallet = wallet.subscribe(() => {});

      try {
        f.manager.start();
        await vi.waitFor(() => expect(f.manager.getSnapshot().phase).toBe('ready'));
        expect(resource.getCurrentResult().error).toBeInstanceOf(ApiRequestError);
        walletQuery.mockRejectedValue(new ApiRequestError('http', 503));
        f.manager.retry();
        await vi.waitFor(() => expect(f.manager.getSnapshot().phase).toBe('unavailable'));
        walletQuery.mockResolvedValue({ version: 2 });
        f.manager.retry();
        await vi.waitFor(() => expect(f.manager.getSnapshot().phase).toBe('ready'));
        expect(wallet.getCurrentResult().data?.version).toBe(2);
      } finally {
        offResource();
        offWallet();
        resource.destroy();
        wallet.destroy();
        f.manager.stop();
        f.cache.clear();
      }
    },
  );
  it('still blocks bids when an active room cannot be refreshed', async () => {
    const f = fixture();
    const room = new QueryObserver(f.cache, {
      queryKey: ['public', 'room', 'lot'],
      queryFn: async () => {
        throw new ApiRequestError('http', 503);
      },
      retry: false,
    });
    const off = room.subscribe(() => {});

    try {
      f.manager.start();
      await vi.waitFor(() => expect(f.manager.getSnapshot().phase).toBe('unavailable'));
    } finally {
      off();
      room.destroy();
      f.manager.stop();
      f.cache.clear();
    }
  });
});
