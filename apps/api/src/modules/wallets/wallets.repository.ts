import type { Wallet } from '../../generated/main/client';
import { Injectable } from '@nestjs/common';
import { DatabaseService, TransactionContext } from '../../database/database.service';

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
