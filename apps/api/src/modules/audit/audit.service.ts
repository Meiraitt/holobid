import { Injectable } from '@nestjs/common';

import { DatabaseService, TransactionContext } from '../../database/database.service';
import type { AuditCheckpoint } from '../../generated/audit/client';

import { auditPending, auditTampered, auditUnavailable } from './audit.errors';
import { AuditSnapshot, AuditVerdict, snapshotHead, verdict } from './audit.types';
import { AuditAnchorRepository } from './audit-anchor.repository';
import { AuditChainService } from './audit-chain.service';
import { AuditCrypto } from './audit-crypto.service';
import { AuditSourceRepository } from './audit-source.repository';

@Injectable()
export class AuditService {
  constructor(
    private readonly database: DatabaseService,
    private readonly anchors: AuditAnchorRepository,
    private readonly source: AuditSourceRepository,
    private readonly chain: AuditChainService,
    private readonly crypto: AuditCrypto,
  ) {}

  async lockedSnapshot(auctionId: string, tx: TransactionContext) {
    await this.source.lock(auctionId, tx);

    return this.source.read(auctionId, tx);
  }

  // For batch readers that already hold every Auction row lock. Reacquiring an
  // advisory lock after a row lock would invert the writers' lock order.
  readLockedSnapshots(auctionIds: string[], tx: TransactionContext) {
    return this.source.readMany(auctionIds, tx);
  }

  async verify(auctionId: string): Promise<AuditVerdict> {
    try {
      return await this.database.transaction(async (tx) =>
        this.verifyLocked(await this.lockedSnapshot(auctionId, tx), auctionId),
      );
    } catch {
      return verdict('INCOMPLETE', 'DEPENDENCY_UNAVAILABLE');
    }
  }

  async verifyLocked(snapshot: AuditSnapshot | null, auctionId: string): Promise<AuditVerdict> {
    try {
      const { checkpoint, pending } = await this.anchors.read(auctionId);

      return this.verifySnapshot(snapshot, checkpoint, Boolean(pending));
    } catch {
      return verdict('INCOMPLETE', 'DEPENDENCY_UNAVAILABLE');
    }
  }

  async verifyLockedBatch(snapshots: AuditSnapshot[]): Promise<Map<string, AuditVerdict>> {
    try {
      const anchors = await this.anchors.readMany(snapshots.map((snapshot) => snapshot.id));

      return new Map(
        snapshots.map((snapshot) => {
          const anchor = anchors.get(snapshot.id);

          return [
            snapshot.id,
            this.verifySnapshot(snapshot, anchor?.checkpoint ?? null, anchor?.pending ?? false),
          ];
        }),
      );
    } catch {
      return new Map(
        snapshots.map((snapshot) => [snapshot.id, verdict('INCOMPLETE', 'DEPENDENCY_UNAVAILABLE')]),
      );
    }
  }

  private verifySnapshot(
    snapshot: AuditSnapshot | null,
    checkpoint: AuditCheckpoint | null,
    pending: boolean,
  ): AuditVerdict {
    try {
      if (pending) {
        return verdict(
          'INCOMPLETE',
          'CONFIRMATION_PENDING',
          checkpoint?.sequence ?? null,
          snapshot?.bids.length ?? null,
        );
      }

      if (!checkpoint) {
        return verdict('INCOMPLETE', 'ANCHOR_MISSING', null, snapshot?.bids.length ?? null);
      }

      if (
        checkpoint.keyId !== this.crypto.keyId ||
        checkpoint.algorithmVersion !== this.crypto.algorithmVersion
      ) {
        return verdict('INCOMPLETE', 'KEY_OR_VERSION_UNAVAILABLE');
      }

      if (!snapshot) {
        return verdict('TAMPERED', 'MAIN_HISTORY_MISSING', checkpoint.sequence, 0);
      }

      const local = this.chain.verify(snapshot);

      if (local.integrity !== 'VERIFIED') {
        return { ...local, expectedCount: checkpoint.sequence };
      }

      if (
        checkpoint.sequence !== snapshot.bidCount ||
        checkpoint.headHash !== snapshot.auditHead ||
        checkpoint.headMac !== snapshot.auditMac ||
        !this.crypto.validMac(checkpoint.headHash, checkpoint.headMac)
      ) {
        return {
          ...verdict('TAMPERED', 'ANCHOR_MISMATCH', checkpoint.sequence, snapshot.bids.length),
          verifiedThroughSequence: local.verifiedThroughSequence,
        };
      }

      return { ...local, reasonCode: 'CONFIRMED' };
    } catch {
      return verdict('INCOMPLETE', 'DEPENDENCY_UNAVAILABLE');
    }
  }

  async requireConfirmed(snapshot: AuditSnapshot) {
    const result = await this.verifyLocked(snapshot, snapshot.id);

    if (result.integrity === 'TAMPERED') {
      throw auditTampered();
    }

    if (result.integrity !== 'VERIFIED') {
      if (result.reasonCode === 'CONFIRMATION_PENDING') {
        throw auditPending();
      }

      throw auditUnavailable();
    }

    return snapshotHead(snapshot);
  }

  async assertPseudonymAvailable(
    auctionId: string,
    bidderId: string,
    tx: TransactionContext,
  ): Promise<string> {
    const pseudonym = this.crypto.pseudonym(auctionId, bidderId);

    if (await tx.bid.findFirst({ where: { auctionId, pseudonym, bidderId: { not: bidderId } } })) {
      throw auditTampered();
    }

    return pseudonym;
  }

  async reconcile(operationKey: string): Promise<'CONFIRMED' | 'PENDING' | 'ABORTED' | 'MISSING'> {
    try {
      const intent = await this.anchors.findOperation(operationKey);

      if (!intent) {
        return 'MISSING';
      }

      if (intent.state === 'COMMITTED') {
        return 'CONFIRMED';
      }

      if (intent.state === 'ABORTED') {
        return 'ABORTED';
      }

      return await this.database.transaction(async (tx) => {
        const snapshot = await this.lockedSnapshot(intent.auctionId, tx);
        const current = await this.anchors.findOperation(operationKey);

        if (current?.id === intent.id && current.state === 'COMMITTED') {
          return 'CONFIRMED';
        }

        if (!current || current.id !== intent.id || current.state !== 'PREPARED') {
          return 'PENDING';
        }

        if (
          !snapshot ||
          !current.proofHash ||
          this.chain.verify(snapshot).integrity !== 'VERIFIED'
        ) {
          return 'PENDING';
        }

        if (
          snapshot.bidCount !== current.nextSequence ||
          snapshot.auditHead !== current.nextHeadHash ||
          snapshot.auditMac !== current.nextHeadMac ||
          snapshot.auditKeyId !== current.keyId ||
          snapshot.auditVersion !== current.algorithmVersion
        ) {
          return 'PENDING';
        }

        if ((await this.source.proof(snapshot, operationKey, tx)) !== current.proofHash) {
          return 'PENDING';
        }

        await this.anchors.commit(operationKey);

        return 'CONFIRMED';
      });
    } catch {
      return 'PENDING';
    }
  }
}
