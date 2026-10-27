import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { DepositResponse, WalletResponse } from '@holobid/contracts';

import { ApiException } from '../../common/http/api.exception';
import { RateLimitException } from '../../common/http/rate-limit.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { MAX_MONEY_CENTS } from '../../common/money';

import { DepositRateLimiter } from './deposit-rate-limiter';
import { presentWallet } from './wallet.presenter';
import { WalletEvents } from './wallet-events';
import { WalletsRepository } from './wallets.repository';

@Injectable()
export class WalletsService {
  constructor(
    private readonly wallets: WalletsRepository,
    private readonly idempotency: IdempotencyService,
    private readonly limiter: DepositRateLimiter,
    private readonly events: WalletEvents,
  ) {}

  async get(userId: string): Promise<WalletResponse> {
    const wallet = await this.wallets.findByUserId(userId);

    if (!wallet) {
      throw new Error('Wallet invariant violated.');
    }

    return presentWallet(wallet);
  }

  async deposit(userId: string, key: string, amountCents: number) {
    let changed = false;
    const result = await this.idempotency.execute<DepositResponse>(
      { userId, operation: 'POST /wallet/deposits', key, request: { amountCents } },
      async (tx) => {
        // Replays bypass this limiter; a lost response can always be recovered.
        const retryAfter = this.limiter.consume(userId);

        if (retryAfter !== null) {
          throw new RateLimitException(retryAfter);
        }

        const wallet = await this.wallets.lock(userId, tx);
        const amount = BigInt(amountCents);

        if (wallet.totalCents + amount > BigInt(MAX_MONEY_CENTS)) {
          throw new ApiException(
            422,
            'BALANCE_LIMIT_EXCEEDED',
            'The deposit would exceed the balance limit.',
          );
        }

        const depositId = randomUUID();
        const updated = await this.wallets.credit(userId, amount, tx);

        await this.wallets.recordDeposit(userId, depositId, amount, tx);
        changed = true;

        return {
          status: 201,
          resourceId: depositId,
          body: { depositId, wallet: presentWallet(updated) },
        };
      },
    );

    if (changed) {
      this.events.publish(userId);
    }

    return result;
  }
}
