import { describe, expect, it } from 'vitest';

import { parseMoney } from '../lib/format';

import { createDemoState } from './fixtures';
import { bidDemo, depositDemo, reservedBalance } from './model';

describe('visual demo consistency', () => {
  const now = Date.UTC(2026, 9, 27, 12);

  it('parses BRL amounts without accepting ambiguous or negative values', () => {
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('0,01')).toBe(1);
    for (const input of ['-5', '1.2', '1,999', '', 'NaN', '0']) {
      expect(parseMoney(input)).toBeNull();
    }
  });
  it('updates available balance when a deposit is made', () => {
    const state = createDemoState(now);
    const next = depositDemo(state, 5000);

    expect(next.totalCents - reservedBalance(next)).toBe(105000);
    expect(state.totalCents).toBe(125000);
  });
  it('rejects a consecutive bid from the current leader', () => {
    const state = createDemoState(now);

    expect(() => bidDemo(state, 'pikachu-live', 26000, now)).toThrow(/liderando/);
    expect(reservedBalance(state)).toBe(25000);
  });
  it('rejects bids beyond available funds, below minimum, or on closed auctions', () => {
    const state = createDemoState(now);

    expect(() => bidDemo(state, 'charizard-live', 110000, now)).toThrow(/Saldo/);
    expect(() => bidDemo(state, 'charizard-live', 38000, now)).toThrow(/mínimo/);
    expect(() => bidDemo(state, 'charizard-won', 67000, now)).toThrow(/recebendo/);
  });
  it('extends a last-minute accepted bid and records it once', () => {
    const state = createDemoState(now);
    const next = bidDemo(state, 'charizard-live', 40000, now + 180000);

    expect(next.auctions[0]?.endsAt).toBe(new Date(now + 300000).toISOString());
    expect(next.bids.length).toBe(state.bids.length + 1);
  });
  it('requires a bidder and valid integer cents for financial demo actions', () => {
    const state = createDemoState(now);

    expect(() => depositDemo({ ...state, user: null }, 100)).toThrow();
    expect(() => depositDemo(state, 0.5)).toThrow();
    expect(() =>
      bidDemo(
        { ...state, user: { name: 'Mesa', email: 'mesa@example.test', role: 'auctioneer' } },
        'charizard-live',
        40000,
        now,
      ),
    ).toThrow();
  });
});
