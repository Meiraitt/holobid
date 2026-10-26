import { Injectable } from '@nestjs/common';
import { AuditDatabaseService, AuditTransactionContext } from '../../database/audit-database.service';
import type { AuditCheckpoint, AuditIntent } from '../../generated/audit/client';
import { AuditHead, AuditProposal } from './audit.types';
import { auditPending, auditTampered } from './audit.errors';

function matches(head: AuditCheckpoint | null, expected: AuditHead | null): boolean {
  return expected === null ? head === null : head !== null && head.sequence === expected.sequence && head.headHash === expected.hash
    && head.headMac === expected.mac && head.keyId === expected.keyId && head.algorithmVersion === expected.algorithmVersion;
}
function sameIntent(intent: AuditIntent, proposal: AuditProposal): boolean {
  return intent.id === proposal.attemptId && intent.auctionId === proposal.auctionId && intent.expectedSequence === (proposal.expected?.sequence ?? null)
    && intent.expectedHeadHash === (proposal.expected?.hash ?? null) && intent.nextSequence === proposal.next.sequence
    && intent.nextHeadHash === proposal.next.hash && intent.nextHeadMac === proposal.next.mac && intent.keyId === proposal.next.keyId
    && intent.algorithmVersion === proposal.next.algorithmVersion && intent.proofHash === proposal.proofHash && intent.requestHash === (proposal.requestHash ?? null);
}

@Injectable()
export class AuditAnchorRepository {
  constructor(private readonly database: AuditDatabaseService) {}
  private async lock(tx: AuditTransactionContext, value: string, namespace = 0) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${value}, ${namespace}::bigint))`;
  }
  findOperation(operationKey: string) { return this.database.client.auditIntent.findUnique({ where: { operationKey } }); }
  read(auctionId: string) {
    return this.database.transaction(async tx => {
      await this.lock(tx, auctionId);
      const checkpoint = await tx.auditCheckpoint.findUnique({ where: { auctionId } });
      const pending = await tx.auditIntent.findFirst({ where: { auctionId, state: 'PREPARED' } });
      return { checkpoint, pending };
    });
  }
  prepare(proposal: AuditProposal) {
    return this.database.transaction(async tx => {
      await this.lock(tx, proposal.operationKey, 1); await this.lock(tx, proposal.auctionId);
      const existing = await tx.auditIntent.findUnique({ where: { operationKey: proposal.operationKey } });
      if (existing && existing.state !== 'ABORTED') {
        if (!sameIntent(existing, proposal)) throw auditPending();
        return existing;
      }
      if (await tx.auditIntent.findFirst({ where: { auctionId: proposal.auctionId, state: 'PREPARED' } })) throw auditPending();
      const checkpoint = await tx.auditCheckpoint.findUnique({ where: { auctionId: proposal.auctionId } });
      if (!matches(checkpoint, proposal.expected)) throw auditTampered();
      if (proposal.next.sequence !== (proposal.expected === null ? 0 : proposal.expected.sequence + 1)) throw auditTampered();
      const data = { id: proposal.attemptId, auctionId: proposal.auctionId, operationKey: proposal.operationKey, expectedSequence: proposal.expected?.sequence,
        expectedHeadHash: proposal.expected?.hash, nextSequence: proposal.next.sequence, nextHeadHash: proposal.next.hash,
        nextHeadMac: proposal.next.mac, keyId: proposal.next.keyId, algorithmVersion: proposal.next.algorithmVersion,
        proofHash: proposal.proofHash, requestHash: proposal.requestHash ?? null, state: 'PREPARED' as const, resolvedAt: null };
      // Only a known rollback permits reusing this operation; unresolved intents are immutable.
      return existing ? tx.auditIntent.update({ where: { id: existing.id }, data: { ...data, expectedSequence: data.expectedSequence ?? null, expectedHeadHash: data.expectedHeadHash ?? null } })
        : tx.auditIntent.create({ data });
    });
  }
  commit(operationKey: string) {
    return this.database.transaction(async tx => {
      await this.lock(tx, operationKey, 1);
      const intent = await tx.auditIntent.findUniqueOrThrow({ where: { operationKey } });
      if (intent.state === 'COMMITTED') return intent;
      if (intent.state !== 'PREPARED') throw auditPending();
      await this.lock(tx, intent.auctionId);
      const checkpoint = await tx.auditCheckpoint.findUnique({ where: { auctionId: intent.auctionId } });
      const next = { sequence: intent.nextSequence, headHash: intent.nextHeadHash, headMac: intent.nextHeadMac,
        keyId: intent.keyId, algorithmVersion: intent.algorithmVersion };
      if (intent.expectedSequence === null) {
        if (checkpoint) throw auditTampered();
        await tx.auditCheckpoint.create({ data: { auctionId: intent.auctionId, ...next } });
      } else {
        if (!checkpoint || checkpoint.sequence !== intent.expectedSequence || checkpoint.headHash !== intent.expectedHeadHash ||
            checkpoint.keyId !== intent.keyId || checkpoint.algorithmVersion !== intent.algorithmVersion) throw auditTampered();
        const updated = await tx.auditCheckpoint.updateMany({ where: { auctionId: intent.auctionId, sequence: intent.expectedSequence,
          headHash: intent.expectedHeadHash! }, data: { ...next, version: { increment: 1 } } });
        if (updated.count !== 1) throw auditPending();
      }
      return tx.auditIntent.update({ where: { id: intent.id }, data: { state: 'COMMITTED', resolvedAt: new Date() } });
    });
  }
  abortKnownRollback(operationKey: string, attemptId: string) {
    return this.database.transaction(async tx => {
      await this.lock(tx, operationKey, 1);
      const intent = await tx.auditIntent.findUnique({ where: { operationKey } });
      if (!intent || intent.id !== attemptId || intent.state === 'ABORTED') return;
      if (intent.state === 'COMMITTED') throw auditPending();
      await this.lock(tx, intent.auctionId);
      await tx.auditIntent.update({ where: { id: intent.id }, data: { state: 'ABORTED', resolvedAt: new Date() } });
    });
  }
}
