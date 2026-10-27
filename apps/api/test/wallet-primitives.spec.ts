import { FixedWindowLimiter } from '../src/common/http/fixed-window-limiter';
import { MAX_MONEY_CENTS, moneyToNumber } from '../src/common/money';

describe('Wallet boundaries', () => {
  it('converts only safe domain money values', () => {
    expect(moneyToNumber(0n)).toBe(0);
    expect(moneyToNumber(BigInt(MAX_MONEY_CENTS))).toBe(MAX_MONEY_CENTS);
    expect(() => moneyToNumber(-1n)).toThrow();
    expect(() => moneyToNumber(BigInt(MAX_MONEY_CENTS) + 1n)).toThrow();
  });
  it('limits independent users and expires buckets without a timer', () => {
    const limiter = new FixedWindowLimiter(2, 60_000, 2);

    expect(limiter.consume('alice', 0)).toBeNull();
    expect(limiter.consume('alice', 0)).toBeNull();
    expect(limiter.consume('alice', 1_000)).toBe(59);
    expect(limiter.consume('bob', 1_000)).toBeNull();
    expect(limiter.consume('carol', 1_000)).toBe(60);
    expect(limiter.consume('carol', 61_000)).toBeNull();
    expect(limiter.consume('alice', 61_000)).toBeNull();
  });
});
