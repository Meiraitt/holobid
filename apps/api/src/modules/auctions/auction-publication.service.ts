import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AuctionDetail, AuctionPublicationPending, CreateAuctionInput } from '@holobid/contracts';
import { ApiException } from '../../common/http/api.exception';
import { RateLimitException } from '../../common/http/rate-limit.exception';
import { IdempotencyInput, IdempotencyService, OperationResult } from '../../common/idempotency/idempotency.service';
import { CatalogImportService } from '../catalog/catalog-import.service';
import { AuditService } from '../audit/audit.service';
import { AuditCrypto } from '../audit/audit-crypto.service';
import { AuditAnchorRepository } from '../audit/audit-anchor.repository';
import { AuditProtocolService } from '../audit/audit-protocol.service';
import { auditUnavailable } from '../audit/audit.errors';
import { AuctionsRepository } from './auctions.repository';
import { AuctionClock } from './auction-clock';
import { AuctionPublishLimiter } from './auction-publish-limiter';
import { presentDetail } from './auction.presenter';

const OPERATION = 'POST /auctions';
function validateDates(input: CreateAuctionInput, now: Date) {
  if (new Date(input.endsAt) <= new Date(input.startsAt) || new Date(input.endsAt) <= now) {
    throw new ApiException(400, 'VALIDATION_ERROR', 'The end must be after the start and the current time.');
  }
}
function pending(operationId: string, auctionId: string): OperationResult<AuctionPublicationPending> {
  return { status: 202, body: { operationId, auctionId, confirmation: 'PENDING' } };
}

@Injectable()
export class AuctionPublicationService {
  constructor(private readonly auctions: AuctionsRepository, private readonly catalog: CatalogImportService,
    private readonly idempotency: IdempotencyService, private readonly crypto: AuditCrypto, private readonly anchors: AuditAnchorRepository,
    private readonly audit: AuditService, private readonly protocol: AuditProtocolService, private readonly clock: AuctionClock, private readonly limiter: AuctionPublishLimiter) {}

  private async resolve(result: OperationResult<AuctionDetail>, operationKey: string) {
    return await this.audit.reconcile(operationKey) === 'CONFIRMED' ? result : pending(operationKey, result.resourceId!);
  }
  async create(userId: string, key: string, dto: CreateAuctionInput): Promise<OperationResult<AuctionDetail | AuctionPublicationPending>> {
    const input = { ...dto, startsAt: new Date(dto.startsAt).toISOString(), endsAt: new Date(dto.endsAt).toISOString() };
    const identity: IdempotencyInput = { userId, key, operation: OPERATION, request: input };
    const operationKey = this.crypto.operationKey(userId, OPERATION, key);
    const existing = await this.idempotency.find<AuctionDetail>(identity);
    if (existing) return this.resolve(existing, operationKey);
    let intent;
    try { intent = await this.anchors.findOperation(operationKey); } catch { throw auditUnavailable(); }
    if (intent && intent.state !== 'ABORTED') {
      if (intent.requestHash && intent.requestHash !== this.idempotency.fingerprint(identity.request)) {
        throw new ApiException(409, 'IDEMPOTENCY_KEY_REUSED', 'This key was used with a different request.');
      }
      // A missing main record after an uncertain commit is not permission to publish again.
      await this.audit.reconcile(operationKey);
      const recovered = await this.idempotency.find<AuctionDetail>(identity);
      return recovered ? this.resolve(recovered, operationKey) : pending(operationKey, intent.auctionId);
    }
    validateDates(input, this.clock.now());
    const retryAfter = this.limiter.consume(userId); if (retryAfter !== null) throw new RateLimitException(retryAfter);
    const prepared = await this.catalog.prepare(input.externalItemId); // Never fetch inside SQL transactions.
    const id = randomUUID();
    let changed = false;
    const execution = await this.protocol.run(operationKey, async (tx, prepare) => {
      const result = await this.idempotency.inTransaction<AuctionDetail>(tx, identity, async () => {
        await this.audit.lockedSnapshot(id, tx);
        const now = this.clock.now(); validateDates(input, now);
        const item = await this.catalog.persist(prepared, tx);
        await this.auctions.create(id, userId, item, input, this.crypto.keyId, tx);
        const snapshot = (await this.audit.lockedSnapshot(id, tx))!;
        const head = this.crypto.genesis(snapshot); await this.auctions.setGenesis(id, head, tx);
        snapshot.auditHead = head.hash; snapshot.auditMac = head.mac;
        changed = true;
        return { status: 201, resourceId: id, body: presentDetail(snapshot, now, 'VERIFIED') };
      }, operationKey);
      // The stored response is complete before the anchored operation proof is computed.
      if (changed) await prepare(id, null);
      return result;
    });
    if (execution.confirmation === 'CONFIRMED') return execution.value;
    if (!changed) return this.resolve(execution.value, operationKey);
    return pending(operationKey, execution.value.resourceId!);
  }
}
