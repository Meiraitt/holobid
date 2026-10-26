import { createHash } from 'node:crypto';
export const DAY_MS = 86_400_000;
export const DEMO_PASSWORD = 'HoloBidDemo123!'; // Intentionally public; never reused outside this demo.
export function demoId(name: string): string {
  const bytes = createHash('sha256').update(`holobid:demo:v1:${name}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const DEMO_ACCOUNTS = [
  { id: demoId('auctioneer'), email: 'auctioneer@demo.holobid.test', role: 'AUCTIONEER' as const, balance: 0n },
  { id: demoId('bidder1'), email: 'bidder1@demo.holobid.test', role: 'BIDDER' as const, balance: 50_000n },
  { id: demoId('bidder2'), email: 'bidder2@demo.holobid.test', role: 'BIDDER' as const, balance: 50_000n },
] as const;
export function demoWindow(now: Date) {
  const startsAt = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS), endsAt = new Date(startsAt.getTime() + DAY_MS);
  return { id: demoId(`day:${startsAt.toISOString()}`), startsAt, endsAt };
}
