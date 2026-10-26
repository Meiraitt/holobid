import type { Wallet, WalletEntryType } from '../../generated/main/client';
import { Injectable } from '@nestjs/common';
import { DatabaseService, TransactionContext } from '../../database/database.service';

import { ApiException } from '../../common/http/api.exception';
import { MAX_MONEY_CENTS } from '../../common/money';

@Injectable()
export class WalletsRepository {
  constructor(private readonly database: DatabaseService) {}

  findByUserId(userId: string, tx?: TransactionContext) {
    return (tx ?? this.database.client).wallet.findUnique({ where: { userId } });
  }

  async lock(userId: string, tx: TransactionContext): Promise<Wallet> {
    const rows = await tx.$queryRaw<Wallet[]>`SELECT * FROM "Wallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
    if (!rows[0]) throw new Error('Wallet invariant violated.');
    return rows[0];
  }

  async lockManyChecked(userIds: string[], tx: TransactionContext) {
    const wallets = new Map<string, Wallet>();
    // Every auction operation locks its lot first, then wallets in this same order.
    for (const id of [...new Set(userIds)].sort()) wallets.set(id, await this.lock(id, tx));
    for (const [id, wallet] of wallets) {
      const active = await tx.reservation.aggregate({ where: { userId: id, status: 'ACTIVE' }, _sum: { amountCents: true } });
      if (wallet.reservedCents !== (active._sum.amountCents ?? 0n) || wallet.reservedCents < 0n ||
          wallet.totalCents < wallet.reservedCents || wallet.totalCents > BigInt(MAX_MONEY_CENTS)) {
        throw new ApiException(409, 'WALLET_INCONSISTENT', 'Wallet reservations require investigation.');
      }
    }
    return wallets;
  }

  async move(userId: string, type: WalletEntryType, reference: string, totalDeltaCents: bigint, reservedDeltaCents: bigint, tx: TransactionContext) {
    const wallet = await tx.wallet.update({ where: { userId }, data: { totalCents: { increment: totalDeltaCents },
      reservedCents: { increment: reservedDeltaCents }, version: { increment: 1 } } });
    await tx.walletEntry.create({ data: { userId, type, reference, totalDeltaCents, reservedDeltaCents } });
    return wallet;
  }

  credit(userId: string, amountCents: bigint, tx: TransactionContext) {
    return tx.wallet.update({ where: { userId }, data: { totalCents: { increment: amountCents }, version: { increment: 1 } } });
  }

  recordDeposit(userId: string, depositId: string, amountCents: bigint, tx: TransactionContext) {
    return tx.walletEntry.create({ data: {
      id: depositId, userId, type: 'DEPOSIT', reference: depositId, totalDeltaCents: amountCents, reservedDeltaCents: 0n,
    } });
  }

  create(userId: string, tx: TransactionContext) {
    return tx.wallet.create({ data: { userId } });
  }
}
