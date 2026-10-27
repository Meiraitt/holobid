import { ApiRequestError } from './api-error';
import { createOperation, type Operation } from './operations';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Preserve uncertain mutations across reloads; never retry them with a new key/body.
export class DurableAttempt<Input extends object, Result> {
  operation?: Operation<Input>;

  private inFlight?: Promise<Result>;

  constructor(
    private readonly send: (operation: Operation<Input>) => Promise<Result>,
    private readonly confirmed: (result: Result) => boolean,
    private readonly store: Store,
    private readonly storageKey: string,
    validate: (input: Input) => boolean,
  ) {
    const saved = store.getItem(storageKey);

    if (saved) {
      const operation = JSON.parse(saved) as Operation<Input>;

      if (
        !/^[0-9a-f-]{36}$/i.test(operation.key) ||
        !operation.input ||
        !validate(operation.input)
      ) {
        throw new Error('Cannot recover the pending operation.');
      }

      this.operation = Object.freeze({ key: operation.key, input: Object.freeze(operation.input) });
    }
  }

  submit(input?: Input): Promise<Result> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const retrying = Boolean(this.operation);

    if (!this.operation) {
      if (!input) {
        return Promise.reject(new Error('Missing operation input.'));
      }

      const operation = createOperation(input);

      this.store.setItem(this.storageKey, JSON.stringify(operation));
      this.operation = operation;
    }

    this.inFlight = this.send(this.operation)
      .then((result) => {
        if (this.confirmed(result)) {
          this.clear();
        }

        return result;
      })
      .catch((error: unknown) => {
        const rejected =
          error instanceof ApiRequestError &&
          ([400, 403, 404, 422, 429].includes(error.status) ||
            [
              'AUCTION_HAS_BIDS',
              'AUCTION_ENDED',
              'AUCTION_CANCELLED',
              'AUCTION_NOT_STARTED',
              'ALREADY_LEADING',
              'BID_BELOW_MINIMUM',
              'BID_LIMIT_REACHED',
            ].includes(error.problem?.code ?? ''));

        if (!retrying && rejected) {
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
