import type { DepositInput } from '@holobid/contracts';

import { parseMoney } from '../../lib/format';
import { DurableAttempt } from '../../services/durable-attempt';
import type { resourceServices } from '../../services/resource-services';

type Deposit = ReturnType<typeof resourceServices>['wallet']['deposit'];

export function depositAmount(value: string) {
  const cents = parseMoney(value);

  return cents !== null && cents <= 100_000_000_000 ? cents : null;
}

export function depositAttempt(send: Deposit, store: Storage, userId: string) {
  return new DurableAttempt(
    send,
    (result) =>
      result.status === 201 &&
      typeof result.data.depositId === 'string' &&
      result.data.depositId.length > 0,
    store,
    `holobid-deposit:${userId}`,
    (input: DepositInput) =>
      Number.isSafeInteger(input.amountCents) &&
      input.amountCents > 0 &&
      input.amountCents <= 100_000_000_000,
  );
}
