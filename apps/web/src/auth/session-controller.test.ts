import { describe, expect, it, vi } from 'vitest';

import type { AuthResponse } from '@holobid/contracts';

import { ApiRequestError } from '../services/api-error';

import { safeDestination } from './navigation';
import { SessionController, type SessionCoordinator } from './session-controller';

const result: AuthResponse = {
  user: { id: 'a', email: 'a@example.test', role: 'BIDDER' },
  accessToken: 'memory-only',
  expiresIn: 900,
};

function fixture() {
  let signedOut = false;
  let notify: (state: 'active' | 'signed-out') => void = () => {};

  const coordination: SessionCoordinator = {
    exclusive: (work) => work(),
    signedOut: () => signedOut,
    publish: (state) => {
      signedOut = state === 'signed-out';
    },
    subscribe: (callback) => {
      notify = callback;

      return () => {};
    },
  };
  const api = {
    login: vi.fn(async () => result),
    register: vi.fn(async () => result),
    refresh: vi.fn(async () => result),
    logout: vi.fn(async () => {}),
    me: vi.fn(async () => result.user),
  };
  const clear = vi.fn();
  const session = new SessionController(api, coordination, clear);

  session.connect();

  return { api, session, clear, notify: (state: 'active' | 'signed-out') => notify(state) };
}

describe('session failure and race boundaries', () => {
  it('keeps a network outage distinct from an expired session and permits recovery', async () => {
    const { session, api } = fixture();

    api.refresh.mockRejectedValueOnce(new ApiRequestError('network'));
    await session.restore();
    expect(session.getSnapshot().status).toBe('unavailable');
    await session.restore();
    expect(session.getSnapshot().status).toBe('authenticated');
    expect(session.getSnapshot()).not.toHaveProperty('accessToken');
  });

  it('does not silently restore a locally signed-out session if remote logout fails', async () => {
    const { session, api, clear } = fixture();

    await session.restore();
    api.logout.mockRejectedValueOnce(new ApiRequestError('network'));
    await expect(session.logout()).rejects.toMatchObject({ kind: 'network' });
    expect(session.token()).toBeNull();
    expect(clear).toHaveBeenCalled();
    await session.restore();
    expect(api.refresh).toHaveBeenCalledTimes(1);
    await session.logout();
    expect(api.logout).toHaveBeenLastCalledWith('memory-only');
  });

  it('reuses a newer access token when a late 401 refers to the previous token', async () => {
    const { session, api } = fixture();

    await session.restore();
    expect(await session.refresh('old-token')).toBe('memory-only');
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores a sign-in response arriving after logout', async () => {
    const { session, api } = fixture();
    let complete!: (value: AuthResponse) => void;

    api.login.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );

    const signingIn = session.signIn('login', {
      email: 'a@example.test',
      password: 'password-example',
    });

    await session.logout();
    complete(result);
    await expect(signingIn).rejects.toMatchObject({ kind: 'aborted' });
    expect(session.token()).toBeNull();
  });

  it('restores the new account after a cross-tab change interrupts an old refresh', async () => {
    const { session, api, notify } = fixture();
    let complete!: (value: AuthResponse) => void;

    api.refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );

    const restoring = session.restore();

    notify('active');
    complete(result);
    await restoring;
    await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(2));
    expect(session.getSnapshot().status).toBe('authenticated');
    notify('signed-out');
    expect(session.getSnapshot().status).toBe('anonymous');
  });
});

describe('safe redirects', () => {
  it.each([
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/%2f%2fevil.test',
    '/login',
    '/%6cogin',
    '/foo/../login',
    '/register?next=/wallet',
    '/my-auctions',
    '/auctions/new',
    '/a\nb',
  ])('rejects %s for a bidder', (path) => {
    expect(safeDestination(path, 'BIDDER')).toBe('/auctions');
  });
  it('preserves local deep links and chooses the role home', () => {
    expect(safeDestination('/wallet?from=auction#balance', 'BIDDER')).toBe(
      '/wallet?from=auction#balance',
    );
    expect(safeDestination('/wallet', 'AUCTIONEER')).toBe('/my-auctions');
    expect(safeDestination(undefined, 'AUCTIONEER')).toBe('/my-auctions');
  });
});
