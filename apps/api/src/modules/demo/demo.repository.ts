import { Injectable } from '@nestjs/common';

import { DatabaseService, TransactionContext } from '../../database/database.service';
import { WalletsRepository } from '../wallets/wallets.repository';

import { DEMO_ACCOUNTS, demoId } from './demo.constants';

@Injectable()
export class DemoRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly wallets: WalletsRepository,
  ) {}

  async accounts(hashes: string[], now: Date, tx: TransactionContext) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('holobid:demo:accounts', 0))`;
    for (const [i, account] of DEMO_ACCOUNTS.entries()) {
      const existing = await tx.user.findFirst({
        where: { OR: [{ id: account.id }, { email: account.email }] },
      });

      if (existing) {
        if (
          existing.id !== account.id ||
          existing.email !== account.email ||
          existing.role !== account.role ||
          !(await tx.wallet.findUnique({ where: { userId: account.id } }))
        ) {
          throw new Error(
            'Demo account collision or inconsistent setup. Existing accounts were not changed.',
          );
        }

        continue;
      }

      await tx.user.create({
        data: {
          id: account.id,
          email: account.email,
          role: account.role,
          passwordHash: hashes[i]!,
          createdAt: now,
          wallet: { create: {} },
        },
      });
      if (account.balance) {
        await this.wallets.move(
          account.id,
          'DEPOSIT',
          demoId(`funds:${account.id}`),
          account.balance,
          0n,
          tx,
        );
      }
    }

    return tx.user.findUniqueOrThrow({ where: { id: DEMO_ACCOUNTS[0].id } });
  }

  lockCreation(tx: TransactionContext) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('holobid:demo:publication', 0))`;
  }

  open(tx?: TransactionContext) {
    return (tx ?? this.database.client).auction.findFirst({
      where: { isDemo: true, lifecycle: 'OPEN' },
      orderBy: { createdAt: 'desc' },
    });
  }

  latest(tx?: TransactionContext) {
    return (tx ?? this.database.client).auction.findFirst({
      where: { isDemo: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  find(id: string) {
    return this.database.client.auction.findUnique({ where: { id } });
  }
}
