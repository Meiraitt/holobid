import { describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from './api-error';
import { DurableAttempt } from './durable-attempt';
import type { Operation } from './operations';

function fixture() {
  const saved = new Map<string, string>();
  const store = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
    removeItem: (key: string) => {
      saved.delete(key);
    },
  };
  const send = vi
    .fn<(op: Operation<{ amountCents: number }>) => Promise<boolean>>()
    .mockResolvedValue(true);
  const attempt = (key = 'account:lot') =>
    new DurableAttempt(send, Boolean, store, key, (input) =>
      Number.isSafeInteger(input.amountCents),
    );

  return { send, store, saved, attempt };
}

describe('durable mutation intent', () => {
  it('coalesces double clicks and clears a confirmed intent', async () => {
    const { attempt, send, saved } = fixture();
    const current = attempt();
    const first = current.submit({ amountCents: 100 });

    expect(current.submit({ amountCents: 999 })).toBe(first);
    await first;
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].input.amountCents).toBe(100);
    expect(saved.size).toBe(0);
  });
  it('recovers pending operations with the exact body and key, isolated by account and lot', async () => {
    const { attempt, send } = fixture();

    send.mockResolvedValueOnce(false);

    const initial = attempt();

    await initial.submit({ amountCents: 100 });
    expect(attempt('other:lot').operation).toBeUndefined();
    await attempt().submit({ amountCents: 999 });
    expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
  });
  it('allows correction after a fresh domain rejection', async () => {
    const { attempt, send } = fixture();

    send.mockRejectedValueOnce(
      new ApiRequestError('http', 409, {
        code: 'BID_BELOW_MINIMUM',
        requestId: 'test',
        message: 'below',
      }),
    );

    const current = attempt();

    await expect(current.submit({ amountCents: 100 })).rejects.toThrow();
    expect(current.operation).toBeUndefined();
    await current.submit({ amountCents: 200 });
    expect(send.mock.calls[1]![0].key).not.toBe(send.mock.calls[0]![0].key);
  });
  it('does not discard an uncertain intent after a later rejection', async () => {
    const { attempt, send } = fixture();

    send.mockRejectedValueOnce(new ApiRequestError('network'));
    send.mockRejectedValueOnce(
      new ApiRequestError('http', 409, {
        code: 'AUCTION_ENDED',
        requestId: 'test',
        message: 'ended',
      }),
    );
    await expect(attempt().submit({ amountCents: 100 })).rejects.toThrow();

    const restored = attempt();

    await expect(restored.submit()).rejects.toThrow();
    expect(restored.operation).toBeDefined();
  });
  it('does not send if journal persistence fails and refuses malformed saved input', () => {
    const { attempt, send, store, saved } = fixture();

    store.setItem = () => {
      throw new Error('Storage unavailable');
    };

    expect(() => attempt().submit({ amountCents: 100 })).toThrow();
    expect(send).not.toHaveBeenCalled();
    saved.set('account:lot', '{}');
    expect(() => attempt()).toThrow();
  });
});
