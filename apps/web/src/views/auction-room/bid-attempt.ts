import type { BidInput } from '@holobid/contracts';

import { parseMoney } from '../../lib/format';
import { DurableAttempt } from '../../services/durable-attempt';
import type { resourceServices } from '../../services/resource-services';

type SendBid = ReturnType<typeof resourceServices>['auctions']['bid'];

export function bidAmount(value: string): number | null {
  const cents = parseMoney(value);

  return cents !== null && cents <= 100_000_000_000 ? cents : null;
}

export function bidAttempt(send: SendBid, store: Storage, userId: string, auctionId: string) {
  return new DurableAttempt(
    (operation: Parameters<SendBid>[1]) => send(auctionId, operation),
    (result) => result.data.confirmation === 'CONFIRMED',
    store,
    `holobid-bid:${userId}:${auctionId}`,
    (input: BidInput) =>
      Number.isSafeInteger(input.amountCents) &&
      input.amountCents > 0 &&
      input.amountCents <= 100_000_000_000,
  );
}
