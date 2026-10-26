import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../database/database.service';
import { AuditCrypto } from './audit-crypto.service';
import type { AuditSnapshot } from './audit.types';
import type { Json } from '../../common/canonical-json';

@Injectable()
export class AuditSourceRepository {
  constructor(private readonly crypto: AuditCrypto) {}
  async lock(auctionId: string, tx: TransactionContext): Promise<void> {
    // Also serializes publication/recovery while the auction row does not yet exist.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${auctionId}, 0))`;
    await tx.$queryRaw`SELECT "id" FROM "Auction" WHERE "id" = ${auctionId}::uuid FOR UPDATE`;
  }
  async read(auctionId: string, tx: TransactionContext): Promise<AuditSnapshot | null> {
    const auction = await tx.auction.findUnique({ where: { id: auctionId } });
    if (!auction) return null;
    // A transaction has one connection; avoid Prisma's parallel relation queries.
    const snapshot = await tx.catalogSnapshot.findUniqueOrThrow({ where: { id: auction.snapshotId } });
    const image = await tx.mediaAsset.findUniqueOrThrow({ where: { id: auction.imageId } });
    const bids = await tx.bid.findMany({ where: { auctionId }, orderBy: { sequence: 'asc' } });
    return { ...auction, snapshot, image, bids };
  }
  async requestHash(operationKey: string, tx: TransactionContext) {
    return (await tx.idempotencyRecord.findUniqueOrThrow({ where: { id: operationKey }, select: { requestHash: true } })).requestHash;
  }
  async proof(snapshot: AuditSnapshot, operationKey: string, tx: TransactionContext): Promise<string | null> {
    const operation = await tx.idempotencyRecord.findUnique({ where: { id: operationKey } });
    const resourceId = snapshot.bidCount === 0 ? snapshot.id : snapshot.currentBidId;
    if (!operation || operation.state !== 'COMPLETED' || operation.resourceId !== resourceId || !operation.response) return null;
    const entries = await tx.walletEntry.findMany({ where: { reference: resourceId! }, orderBy: { id: 'asc' } });
    const reservations = await tx.reservation.findMany({ where: { auctionId: snapshot.id }, orderBy: { id: 'asc' } });
    // Current wallet totals may change legitimately in another auction/deposit.
    // Bind immutable ledger effects and this auction's reservations instead.
    return this.crypto.digest(['holobid:main-proof', 1, snapshot.auditKeyId, snapshot.id, snapshot.bidCount, snapshot.auditHead, snapshot.auditMac,
      [operation.id, operation.userId, operation.operation, operation.key, operation.requestHash, operation.resourceId, operation.responseStatus, operation.response as Json],
      entries.map(row => [row.id, row.userId, row.type, row.totalDeltaCents.toString(), row.reservedDeltaCents.toString(), row.reference, row.createdAt.toISOString()]),
      reservations.map(row => [row.id, row.auctionId, row.bidId, row.userId, row.amountCents.toString(), row.status, row.createdAt.toISOString()])]);
  }
}
