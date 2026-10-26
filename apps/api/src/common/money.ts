export const MAX_MONEY_CENTS = 100_000_000_000;

export function moneyToNumber(value: bigint): number {
  if (value < 0n || value > BigInt(MAX_MONEY_CENTS)) throw new Error('Invalid persisted money value.');
  return Number(value);
}
