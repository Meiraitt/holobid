import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { WalletResponse, DepositResponse } from '@holobid/contracts';
import type { Wallet } from '../../generated/main/client';
import { ApiException } from '../../common/http/api.exception';
import { RateLimitException } from '../../common/http/rate-limit.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { MAX_MONEY_CENTS, moneyToNumber } from '../../common/money';
import { WalletsRepository } from './wallets.repository';
import { DepositRateLimiter } from './deposit-rate-limiter';

function present(wallet: Wallet): WalletResponse {
  return {
    totalCents: moneyToNumber(wallet.totalCents), reservedCents: moneyToNumber(wallet.reservedCents),
    availableCents: moneyToNumber(wallet.totalCents - wallet.reservedCents),
    version: wallet.version, serverTime: new Date().toISOString(),
  };
}

@Injectable()
export class WalletsService {
  constructor(private readonly wallets: WalletsRepository, private readonly idempotency: IdempotencyService, private readonly limiter: DepositRateLimiter) {}

  async get(userId: string): Promise<WalletResponse> {
    const wallet = await this.wallets.findByUserId(userId);
    if (!wallet) throw new Error('Wallet invariant violated.');
    return present(wallet);
  }

  deposit(userId: string, key: string, amountCents: number) {
    return this.idempotency.execute<DepositResponse>({ userId, operation: 'POST /wallet/deposits', key, request: { amountCents } }, async tx => {
      // Replays bypass this limiter; a lost response can always be recovered.
      const retryAfter = this.limiter.consume(userId);
      if (retryAfter !== null) throw new RateLimitException(retryAfter);
      const wallet = await this.wallets.lock(userId, tx);
      const amount = BigInt(amountCents);
      if (wallet.totalCents + amount > BigInt(MAX_MONEY_CENTS)) {
        throw new ApiException(422, 'BALANCE_LIMIT_EXCEEDED', 'The deposit would exceed the balance limit.');
      }
      const depositId = randomUUID();
      const updated = await this.wallets.credit(userId, amount, tx);
      await this.wallets.recordDeposit(userId, depositId, amount, tx);
      return { status: 201, resourceId: depositId, body: { depositId, wallet: present(updated) } };
    });
  }
}
