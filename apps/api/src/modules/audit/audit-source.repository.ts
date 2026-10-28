import { Injectable } from '@nestjs/common';

import type { Json } from '../../common/canonical-json';
import type { TransactionContext } from '../../database/database.service';

import type { AuditSnapshot } from './audit.types';
import { AuditCrypto } from './audit-crypto.service';

@Injectable()
export class AuditSourceRepository {
  constructor(private readonly crypto: AuditCrypto) {}

  async lock(auctionId: string, tx: TransactionContext): Promise<void> {
    // Also serializes publication/recovery while the auction row does not yet exist.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${auctionId}, 0))`;
    await tx.$queryRaw`SELECT "id" FROM "Auction" WHERE "id" = ${auctionId}::uuid FOR UPDATE`;
  }

  async read(auctionId: string, tx: TransactionContext): Promise<AuditSnapshot | null> {
    return (await this.readMany([auctionId], tx))[0] ?? null;
  }

  // Callers must hold every requested Auction row lock before reading related data.
  async readMany(auctionIds: string[], tx: TransactionContext): Promise<AuditSnapshot[]> {
    if (auctionIds.length === 0) {
      return [];
    }

    const auctions = await tx.auction.findMany({ where: { id: { in: auctionIds } } });
    // One connection per transaction: batch each relation rather than issuing queries per lot.
    const snapshots = await tx.catalogSnapshot.findMany({
      where: { id: { in: auctions.map((lot) => lot.snapshotId) } },
    });
    const images = await tx.mediaAsset.findMany({
      where: { id: { in: auctions.map((lot) => lot.imageId) } },
    });
    const bids = await tx.bid.findMany({
      where: { auctionId: { in: auctionIds } },
      orderBy: [{ auctionId: 'asc' }, { sequence: 'asc' }],
    });
    const bySnapshot = new Map(snapshots.map((row) => [row.id, row]));
    const byImage = new Map(images.map((row) => [row.id, row]));
    const byAuction = new Map<string, AuditSnapshot['bids']>();

    for (const bid of bids) {
      const history = byAuction.get(bid.auctionId) ?? [];

      history.push(bid);
      byAuction.set(bid.auctionId, history);
    }

    return auctions.map((auction) => {
      const snapshot = bySnapshot.get(auction.snapshotId);
      const image = byImage.get(auction.imageId);

      if (!snapshot || !image) {
        throw new Error('Auction snapshot invariant violated.');
      }

      return { ...auction, snapshot, image, bids: byAuction.get(auction.id) ?? [] };
    });
  }

  async requestHash(operationKey: string, tx: TransactionContext) {
    return (
      await tx.idempotencyRecord.findUniqueOrThrow({
        where: { id: operationKey },
        select: { requestHash: true },
      })
    ).requestHash;
  }

  async proof(
    snapshot: AuditSnapshot,
    operationKey: string,
    tx: TransactionContext,
  ): Promise<string | null> {
    const operation = await tx.idempotencyRecord.findUnique({ where: { id: operationKey } });
    const resourceId = snapshot.bidCount === 0 ? snapshot.id : snapshot.currentBidId;

    if (
      !operation ||
      operation.state !== 'COMPLETED' ||
      operation.resourceId !== resourceId ||
      !operation.response
    ) {
      return null;
    }

    const entries = await tx.walletEntry.findMany({
      where: { reference: resourceId! },
      orderBy: { id: 'asc' },
    });
    const reservations = await tx.reservation.findMany({
      where: { auctionId: snapshot.id },
      orderBy: { id: 'asc' },
    });

    // Current wallet totals may change legitimately in another auction/deposit.
    // Bind immutable ledger effects and this auction's reservations instead.
    return this.crypto.digest([
      'holobid:main-proof',
      1,
      snapshot.auditKeyId,
      snapshot.id,
      snapshot.bidCount,
      snapshot.auditHead,
      snapshot.auditMac,
      [
        operation.id,
        operation.userId,
        operation.operation,
        operation.key,
        operation.requestHash,
        operation.resourceId,
        operation.responseStatus,
        operation.response as Json,
      ],
      entries.map((row) => [
        row.id,
        row.userId,
        row.type,
        row.totalDeltaCents.toString(),
        row.reservedDeltaCents.toString(),
        row.reference,
        row.createdAt.toISOString(),
      ]),
      reservations.map((row) => [
        row.id,
        row.auctionId,
        row.bidId,
        row.userId,
        row.amountCents.toString(),
        row.status,
        row.createdAt.toISOString(),
      ]),
    ]);
  }
}
