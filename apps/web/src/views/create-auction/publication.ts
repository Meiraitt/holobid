import type { CreateAuctionInput } from '@holobid/contracts';

import { parseMoney } from '../../lib/format';
import { ApiRequestError } from '../../services/api-error';
import { createOperation, type Operation } from '../../services/operations';
import type { resourceServices } from '../../services/resource-services';

export type CreateErrors = Partial<
  Record<'card' | 'startingBid' | 'increment' | 'startsAt' | 'endsAt' | 'form', string>
>;
export type PublicationFields = {
  cardId: string;
  startingBid: string;
  increment: string;
  startImmediately: boolean;
  startsAt: string;
  endsAt: string;
};

const maxMoney = 100_000_000_000;

export function publicationInput(
  fields: PublicationFields,
  now = Date.now(),
): { errors: CreateErrors; input?: CreateAuctionInput } {
  const errors: CreateErrors = {};
  const startingPriceCents = parseMoney(fields.startingBid);
  const minimumIncrementCents = parseMoney(fields.increment);
  const start = fields.startImmediately ? new Date(now) : new Date(fields.startsAt);
  const end = new Date(fields.endsAt);

  if (!fields.cardId) {
    errors.card = 'Selecione uma carta e aguarde os detalhes carregarem.';
  }

  if (startingPriceCents === null || startingPriceCents > maxMoney) {
    errors.startingBid = 'Informe um valor de R$ 0,01 a R$ 1.000.000.000,00, como 100,00.';
  }

  if (minimumIncrementCents === null || minimumIncrementCents > maxMoney) {
    errors.increment = 'Informe um incremento de R$ 0,01 a R$ 1.000.000.000,00, como 10,00.';
  }

  if (!Number.isFinite(start.getTime()) || (!fields.startImmediately && start.getTime() <= now)) {
    errors.startsAt = 'Escolha um horário futuro ou use “Começar agora”.';
  }

  if (!Number.isFinite(end.getTime()) || end.getTime() <= Math.max(now, start.getTime())) {
    errors.endsAt = 'O encerramento deve ser futuro e acontecer depois do início.';
  }

  if (Object.keys(errors).length || startingPriceCents === null || minimumIncrementCents === null) {
    return { errors };
  }

  return {
    errors,
    input: {
      externalItemId: fields.cardId,
      startingPriceCents,
      minimumIncrementCents,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    },
  };
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type Publish = ReturnType<typeof resourceServices>['auctions']['create'];

// One immutable intent per account and browser tab. Survives reloads without storing tokens.
export class PublicationAttempt {
  operation: Operation<CreateAuctionInput> | undefined;

  private inFlight?: ReturnType<Publish>;

  private readonly storageKey: string;

  constructor(
    private readonly publish: Publish,
    private readonly store: Store,
    userId: string,
  ) {
    this.storageKey = `holobid-publication:${userId}`;

    const saved = store.getItem(this.storageKey);

    if (saved) {
      const operation = JSON.parse(saved) as Operation<CreateAuctionInput>;

      if (
        !operation.key ||
        !operation.input?.externalItemId ||
        !Number.isSafeInteger(operation.input.startingPriceCents) ||
        !Number.isSafeInteger(operation.input.minimumIncrementCents) ||
        !Number.isFinite(Date.parse(operation.input.startsAt)) ||
        !Number.isFinite(Date.parse(operation.input.endsAt))
      ) {
        throw new Error(
          'Não foi possível recuperar a publicação desta aba. Confira seus lotes antes de iniciar outra publicação.',
        );
      }

      this.operation = Object.freeze({ key: operation.key, input: Object.freeze(operation.input) });
    }
  }

  submit(input?: CreateAuctionInput): ReturnType<Publish> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const retrying = Boolean(this.operation);

    if (!this.operation) {
      if (!input) {
        return Promise.reject(new Error('Missing publication input.'));
      }

      const operation = createOperation(input);

      // Do not send unless a reload can recover the exact same operation.
      this.store.setItem(this.storageKey, JSON.stringify(operation));
      this.operation = operation;
    }

    this.inFlight = this.publish(this.operation)
      .then((result) => {
        if (result.data.confirmation === 'CONFIRMED') {
          this.clear();
        }

        return result;
      })
      .catch((error: unknown) => {
        // Only a fresh, definitely rejected intent can be edited. A later rejection
        // cannot prove that an earlier uncertain request was never committed.
        if (
          !retrying &&
          error instanceof ApiRequestError &&
          ([400, 403, 404, 422, 429].includes(error.status) ||
            error.problem?.code === 'CATALOG_UNAVAILABLE')
        ) {
          this.clear();
        }

        throw error;
      })
      .finally(() => {
        this.inFlight = undefined;
      });

    return this.inFlight;
  }

  private clear() {
    this.store.removeItem(this.storageKey);
    this.operation = undefined;
  }
}
