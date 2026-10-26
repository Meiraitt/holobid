import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/http/api.exception';
import { DatabaseService, TransactionContext } from '../../database/database.service';
import { AuditAnchorRepository } from './audit-anchor.repository';
import { AuditSourceRepository } from './audit-source.repository';
import { AuditChainService } from './audit-chain.service';
import { AuditHead, AuditProposal, snapshotHead } from './audit.types';
import { auditTampered, auditUnavailable } from './audit.errors';

type Prepare = (auctionId: string, expected: AuditHead | null) => Promise<void>;

@Injectable()
export class AuditProtocolService {
  constructor(private readonly database: DatabaseService, private readonly anchors: AuditAnchorRepository,
    private readonly source: AuditSourceRepository, private readonly chain: AuditChainService) {}

  async run<T>(operationKey: string, work: (tx: TransactionContext, prepare: Prepare) => Promise<T>): Promise<{ value: T; confirmation: 'CONFIRMED' | 'PENDING' }> {
    let proposal: AuditProposal | undefined;
    let callbackFinished = false;
    let value!: T;
    try {
      value = await this.database.transaction(async tx => {
        const result = await work(tx, async (auctionId, expected) => {
          if (proposal) throw new Error('Only one audit transition per transaction is supported.');
          await this.source.lock(auctionId, tx);
          const snapshot = await this.source.read(auctionId, tx);
          if (!snapshot || this.chain.verify(snapshot).integrity !== 'VERIFIED') throw auditTampered();
          const proofHash = await this.source.proof(snapshot, operationKey, tx);
          if (!proofHash) throw new Error('An audited operation needs a completed primary operation record.');
          proposal = { operationKey, attemptId: randomUUID(), auctionId, expected, next: snapshotHead(snapshot), proofHash, requestHash: await this.source.requestHash(operationKey, tx) };
          try { await this.anchors.prepare(proposal); }
          catch (error) { if (error instanceof ApiException) throw error; throw auditUnavailable(); }
        });
        value = result; callbackFinished = true; return result;
      });
    } catch (error) {
      if (!callbackFinished) {
        // The callback failed before COMMIT was requested. Only this attempt may abort.
        if (proposal) {
          try { await this.anchors.abortKnownRollback(operationKey, proposal.attemptId); }
          catch { /* Leave the durable intent pending for investigation if abort is uncertain. */ }
        }
        throw error;
      }
      // A failed COMMIT acknowledgement is not evidence that PostgreSQL rolled back.
      return { value, confirmation: 'PENDING' };
    }
    if (!proposal) return { value, confirmation: 'PENDING' }; // An idempotent replay is reconciled by the caller.
    try { await this.anchors.commit(operationKey); return { value, confirmation: 'CONFIRMED' }; }
    catch { return { value, confirmation: 'PENDING' }; }
  }
}
