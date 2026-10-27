import { Injectable } from '@nestjs/common';

import type { TransactionContext } from '../../database/database.service';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/main/client';

@Injectable()
export class SettlementsRepository {
  constructor(private readonly database: DatabaseService) {}

  find(auctionId: string, tx: TransactionContext) {
    return tx.settlement.findUnique({ where: { auctionId } });
  }

  complete(
    id: string,
    auctionId: string,
    winningBidId: string | null,
    amountCents: bigint,
    now: Date,
    tx: TransactionContext,
  ) {
    const data = {
      winningBidId,
      amountCents,
      status: 'COMPLETED' as const,
      completedAt: now,
      failureCode: null,
    };

    return tx.settlement.upsert({
      where: { auctionId },
      create: { id, auctionId, ...data },
      update: data,
    });
  }

  receipt(data: Prisma.ReceiptUncheckedCreateInput, tx: TransactionContext) {
    return tx.receipt.create({ data });
  }

  consume(id: string, tx: TransactionContext) {
    return tx.reservation.update({ where: { id }, data: { status: 'CONSUMED' } });
  }

  finish(auctionId: string, tx: TransactionContext) {
    return tx.auction.update({
      where: { id: auctionId },
      data: { lifecycle: 'ENDED', settlementStatus: 'COMPLETED', version: { increment: 1 } },
    });
  }

  async failure(
    auctionId: string,
    winningBidId: string | null,
    amountCents: bigint,
    status: 'FAILED' | 'PENDING',
    failureCode: string,
    tx: TransactionContext,
  ) {
    const data = { winningBidId, amountCents, status, failureCode, completedAt: null };

    await tx.settlement.upsert({
      where: { auctionId },
      create: { auctionId, ...data },
      update: data,
    });
    await tx.auction.update({
      where: { id: auctionId },
      data: { lifecycle: 'ENDED', settlementStatus: status, version: { increment: 1 } },
    });
  }

  schedule(id: string) {
    return this.database.client.auction.findUnique({
      where: { id },
      select: { id: true, startsAt: true, endsAt: true, lifecycle: true, settlementStatus: true },
    });
  }

  pendingPage(after?: string) {
    return this.database.client.auction.findMany({
      where: {
        lifecycle: { not: 'CANCELLED' },
        settlementStatus: { in: ['NOT_DUE', 'PENDING'] },
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true },
    });
  }
}
