import type { UserRole } from '@holobid/contracts';

export function safeDestination(value: unknown, role: UserRole): string {
  const fallback = role === 'AUCTIONEER' ? '/my-auctions' : '/auctions';

  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    [...value].some((character) => character.charCodeAt(0) <= 32)
  ) {
    return fallback;
  }

  // Reject encoded paths and auth loops, and don't redirect into the wrong role.
  const path = new URL(value, 'https://holobid.invalid').pathname;

  if (path.includes('%') || /^\/(login|register)(?:\/|$)/.test(path)) {
    return fallback;
  }

  if (role === 'BIDDER' && (path === '/my-auctions' || path === '/auctions/new')) {
    return fallback;
  }

  if (role === 'AUCTIONEER' && (path === '/wallet' || path === '/participations')) {
    return fallback;
  }

  return value;
}
