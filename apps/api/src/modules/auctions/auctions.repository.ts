import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/main/client';
import type { CreateAuctionInput } from '@holobid/contracts';
import { DatabaseService, TransactionContext } from '../../database/database.service';

@Injectable()
export class AuctionsRepository {
  constructor(private readonly database: DatabaseService) {}

  list(where: Prisma.AuctionWhereInput, take: number) {
    return this.database.client.auction.findMany({ where, take, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { snapshot: true, currentBid: { select: { amountCents: true } } } });
  }
  receipt(auctionId: string, tx: TransactionContext) { return tx.receipt.findUnique({ where: { auctionId } }); }
  create(id: string, sellerId: string, item: { snapshotId: string; imageId: string }, input: CreateAuctionInput, keyId: string, tx: TransactionContext) {
    return tx.auction.create({ data: { id, sellerId, ...item, startingPriceCents: BigInt(input.startingPriceCents), minimumIncrementCents: BigInt(input.minimumIncrementCents),
      startsAt: new Date(input.startsAt), originalEndsAt: new Date(input.endsAt), endsAt: new Date(input.endsAt), auditKeyId: keyId,
      auditHead: '0'.repeat(64), auditMac: '0'.repeat(64) } });
  }
  setGenesis(id: string, head: { hash: string; mac: string }, tx: TransactionContext) {
    return tx.auction.update({ where: { id }, data: { auditHead: head.hash, auditMac: head.mac } });
  }
  cancel(id: string, tx: TransactionContext) {
    return tx.auction.update({ where: { id }, data: { lifecycle: 'CANCELLED', version: { increment: 1 } } });
  }

  findOwnedById(id: string, sellerId: string, tx?: TransactionContext) {
    return (tx ?? this.database.client).auction.findFirst({ where: { id, sellerId } });
  }
}
