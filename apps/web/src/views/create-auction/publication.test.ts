import { describe, expect, it, vi } from 'vitest';

import type { AuctionDetail, CreateAuctionInput } from '@holobid/contracts';

import { ApiRequestError } from '../../services/api-error';

import { PublicationAttempt, type PublicationFields, publicationInput } from './publication';

const now = Date.parse('2026-10-27T15:00:00Z');
const fields: PublicationFields = {
  cardId: 'base1-58',
  startingBid: '1.234,56',
  increment: '0,01',
  startImmediately: true,
  startsAt: '',
  endsAt: '2026-10-28T15:00:00Z',
};
const input = publicationInput(fields, now).input!;

function store() {
  const data = new Map<string, string>();

  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe('publication validation', () => {
  it('converts exact BRL cents and UTC dates without sending presentation fields', () => {
    expect(input).toEqual({
      externalItemId: 'base1-58',
      startingPriceCents: 123456,
      minimumIncrementCents: 1,
      startsAt: '2026-10-27T15:00:00.000Z',
      endsAt: '2026-10-28T15:00:00.000Z',
    });
    expect(Object.keys(input)).toHaveLength(5);
  });
  it.each(['0', '-10', '1,001', 'abc', '1.000.000.000,01'])(
    'rejects invalid price/increment %s',
    (value) => {
      expect(
        publicationInput({ ...fields, startingBid: value, increment: value }, now).errors,
      ).toHaveProperty('startingBid');
      expect(
        publicationInput({ ...fields, startingBid: value, increment: value }, now).errors,
      ).toHaveProperty('increment');
    },
  );
  it('validates selection, future scheduling and end-after-start without serializing invalid dates', () => {
    expect(
      publicationInput(
        { ...fields, cardId: '', startImmediately: false, startsAt: 'invalid', endsAt: 'invalid' },
        now,
      ).errors,
    ).toMatchObject({
      card: expect.any(String),
      startsAt: expect.any(String),
      endsAt: expect.any(String),
    });
    expect(
      publicationInput(
        { ...fields, startImmediately: false, startsAt: '2026-10-27T14:00:00Z' },
        now,
      ).errors.startsAt,
    ).toBeTruthy();
    expect(
      publicationInput(
        { ...fields, startImmediately: false, startsAt: '2026-10-29T15:00:00Z' },
        now,
      ).errors.endsAt,
    ).toBeTruthy();
    expect(
      publicationInput(
        { ...fields, startImmediately: false, startsAt: '2026-10-27T14:00:00-03:00' },
        now,
      ).input?.startsAt,
    ).toBe('2026-10-27T17:00:00.000Z');
  });
});

describe('durable publication intent', () => {
  it('coalesces double click and restores the same key/body across reload and user switches', async () => {
    const storage = store();
    const pending = {
      status: 202,
      data: { confirmation: 'PENDING' as const, operationId: 'operation', auctionId: 'auction' },
    };
    const publish = vi.fn(async () => pending);
    const attempt = new PublicationAttempt(publish, storage, 'seller');
    const first = attempt.submit(input);

    expect(attempt.submit(input)).toBe(first);
    await first;
    expect(publish).toHaveBeenCalledTimes(1);

    const restored = new PublicationAttempt(publish, storage, 'seller');

    expect(restored.operation).toEqual(attempt.operation);
    expect(new PublicationAttempt(publish, storage, 'other').operation).toBeUndefined();
    await restored.submit();
    expect(publish.mock.calls[0]).toEqual(publish.mock.calls[1]);
  });
  it('keeps uncertain operations even if a later retry is rejected', async () => {
    const storage = store();
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new ApiRequestError('network', 0))
      .mockRejectedValueOnce(new ApiRequestError('http', 400));
    const attempt = new PublicationAttempt(publish, storage, 'seller');

    await expect(attempt.submit(input)).rejects.toMatchObject({ kind: 'network' });
    expect(attempt.operation).toBeDefined();
    await expect(attempt.submit()).rejects.toMatchObject({ status: 400 });
    expect(attempt.operation).toBeDefined();
    expect(new PublicationAttempt(publish, storage, 'seller').operation).toEqual(attempt.operation);
  });
  it('allows correcting a fresh, definitely rejected intent', async () => {
    const publish = vi.fn().mockRejectedValue(new ApiRequestError('http', 400));
    const storage = store();
    const attempt = new PublicationAttempt(publish, storage, 'seller');

    await expect(attempt.submit(input)).rejects.toMatchObject({ status: 400 });
    expect(attempt.operation).toBeUndefined();
    expect(new PublicationAttempt(publish, storage, 'seller').operation).toBeUndefined();
  });
  it('clears a confirmed intent and stops before HTTP when durable storage is unavailable', async () => {
    const publish = vi.fn(async () => ({
      status: 201,
      data: { confirmation: 'CONFIRMED' } as AuctionDetail,
    }));
    const storage = store();
    const attempt = new PublicationAttempt(publish, storage, 'seller');

    await attempt.submit(input);
    expect(new PublicationAttempt(publish, storage, 'seller').operation).toBeUndefined();

    const broken = new PublicationAttempt(
      publish,
      {
        ...store(),
        setItem: () => {
          throw new Error('storage disabled');
        },
      },
      'seller',
    );

    expect(() => broken.submit(input as CreateAuctionInput)).toThrow('storage disabled');
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
