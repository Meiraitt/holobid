import { Injectable } from '@nestjs/common';

import type { AuctionStatus } from '@holobid/contracts';

import type { TransactionContext } from '../../database/database.service';
import { Auction, Bid, CatalogSnapshot, Prisma } from '../../generated/main/client';

export type AccountPagePosition = { createdAt: Date; id: string };
export type AccountAuction = Auction & {
  snapshot: CatalogSnapshot;
  currentBid: Bid | null;
  receipt: { publicCode: string } | null;
};
export type RankedBid = {
  auctionId: string;
  bidderId: string;
  _max: { amountCents: bigint | null };
};
@Injectable()
export class AccountsRepository {
  private async hydrate(lots: Auction[], tx: TransactionContext): Promise<AccountAuction[]> {
    if (lots.length === 0) {
      return [];
    }

    // Batch related records sequentially: one transaction has one pg connection.
    const snapshots = await tx.catalogSnapshot.findMany({
      where: { id: { in: lots.map((lot) => lot.snapshotId) } },
    });
    const bids = await tx.bid.findMany({
      where: { id: { in: lots.flatMap((lot) => (lot.currentBidId ? [lot.currentBidId] : [])) } },
    });
    const receipts = await tx.receipt.findMany({
      where: { auctionId: { in: lots.map((lot) => lot.id) } },
      select: { auctionId: true, publicCode: true },
    });
    const bySnapshot = new Map(snapshots.map((row) => [row.id, row]));
    const byBid = new Map(bids.map((row) => [row.id, row]));
    const byReceipt = new Map(receipts.map((row) => [row.auctionId, row]));

    return lots.map((lot) => ({
      ...lot,
      snapshot: bySnapshot.get(lot.snapshotId)!,
      currentBid: lot.currentBidId ? (byBid.get(lot.currentBidId) ?? null) : null,
      receipt: byReceipt.get(lot.id) ?? null,
    }));
  }

  async auction(id: string, tx: TransactionContext) {
    const lot = await tx.auction.findUnique({ where: { id } });

    return lot ? (await this.hydrate([lot], tx))[0]! : null;
  }

  async participations(
    userId: string,
    filter: 'all' | 'active' | 'won',
    now: Date,
    take: number,
    position: AccountPagePosition | undefined,
    tx: TransactionContext,
  ) {
    const filters: Prisma.AuctionWhereInput[] = [{ bids: { some: { bidderId: userId } } }];

    if (filter === 'active') {
      filters.push({ lifecycle: 'OPEN', endsAt: { gt: now } });
    }

    if (filter === 'won') {
      filters.push({
        lifecycle: 'ENDED',
        settlementStatus: 'COMPLETED',
        settlement: { is: { status: 'COMPLETED', winningBid: { is: { bidderId: userId } } } },
        receipt: { isNot: null },
      });
    }

    if (position) {
      filters.push({
        OR: [
          { createdAt: { lt: position.createdAt } },
          { createdAt: position.createdAt, id: { lt: position.id } },
        ],
      });
    }

    const lots = await tx.auction.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });

    return this.hydrate(lots, tx);
  }

  async ranks(ids: string[], tx: TransactionContext): Promise<RankedBid[]> {
    const rows = await tx.bid.groupBy({
      by: ['auctionId', 'bidderId'],
      where: { auctionId: { in: ids } },
      _max: { amountCents: true },
    });

    return rows;
  }

  reservations(ids: string[], userId: string, tx: TransactionContext) {
    return tx.reservation.findMany({
      where: { auctionId: { in: ids }, userId, status: 'ACTIVE' },
      select: { auctionId: true, amountCents: true },
    });
  }

  lockOwnedPage(
    userId: string,
    status: AuctionStatus | undefined,
    now: Date,
    take: number,
    position: AccountPagePosition | undefined,
    tx: TransactionContext,
  ) {
    const filters: Prisma.Sql[] = [Prisma.sql`"sellerId" = ${userId}::uuid`];

    if (status === 'CANCELLED') {
      filters.push(Prisma.sql`lifecycle = 'CANCELLED'`);
    }

    if (status === 'SCHEDULED') {
      filters.push(Prisma.sql`lifecycle = 'OPEN' AND "startsAt" > ${now}`);
    }

    if (status === 'LIVE') {
      filters.push(Prisma.sql`lifecycle = 'OPEN' AND "startsAt" <= ${now} AND "endsAt" > ${now}`);
    }

    if (status === 'ENDED') {
      filters.push(
        Prisma.sql`lifecycle <> 'CANCELLED' AND (lifecycle = 'ENDED' OR "endsAt" <= ${now})`,
      );
    }

    if (position) {
      filters.push(Prisma.sql`("createdAt", id) < (${position.createdAt}, ${position.id}::uuid)`);
    }

    // A single stable lock order across dashboard requests; bid writers lock one lot.
    return tx.$queryRaw<Pick<Auction, 'id' | 'createdAt'>[]>(Prisma.sql`
      SELECT id, "createdAt" FROM "Auction" WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY "createdAt" DESC, id DESC LIMIT ${take} FOR UPDATE`);
  }

  receipts(ids: string[], tx: TransactionContext) {
    return tx.receipt.findMany({ where: { auctionId: { in: ids } } });
  }

  async completedSales(userId: string, tx: TransactionContext) {
    return tx.settlement.aggregate({
      where: { auction: { sellerId: userId }, status: 'COMPLETED', winningBidId: { not: null } },
      _sum: { amountCents: true },
      _count: true,
    });
  }

  withoutWinner(userId: string, tx: TransactionContext) {
    return tx.settlement.count({
      where: { auction: { sellerId: userId }, status: 'COMPLETED', winningBidId: null },
    });
  }
}
