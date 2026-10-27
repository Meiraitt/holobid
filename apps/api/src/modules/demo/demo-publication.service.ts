import { Injectable } from '@nestjs/common';

import type { CreateAuctionInput } from '@holobid/contracts';

import { ApiException } from '../../common/http/api.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { AuctionClock } from '../auctions/auction-clock';
import { AuctionEvents } from '../auctions/auction-events';
import { AuctionsRepository } from '../auctions/auctions.repository';
import { AuditService } from '../audit/audit.service';
import { AuditAnchorRepository } from '../audit/audit-anchor.repository';
import { AuditCrypto } from '../audit/audit-crypto.service';
import { AuditProtocolService } from '../audit/audit-protocol.service';
import { CatalogImportService } from '../catalog/catalog-import.service';

import { DEMO_ACCOUNTS } from './demo.constants';
import { DemoRepository } from './demo.repository';
import { DemoFixtures } from './demo-fixtures.service';

@Injectable()
export class DemoPublicationService {
  constructor(
    private readonly repository: DemoRepository,
    private readonly fixtures: DemoFixtures,
    private readonly catalog: CatalogImportService,
    private readonly idempotency: IdempotencyService,
    private readonly crypto: AuditCrypto,
    private readonly audit: AuditService,
    private readonly anchors: AuditAnchorRepository,
    private readonly protocol: AuditProtocolService,
    private readonly auctions: AuctionsRepository,
    private readonly clock: AuctionClock,
    private readonly events: AuctionEvents,
  ) {}

  private key(id: string) {
    return this.crypto.operationKey(DEMO_ACCOUNTS[0].id, 'DEMO_PUBLISH', id);
  }

  private async confirmed(id: string) {
    if (
      (await this.audit.reconcile(this.key(id))) !== 'CONFIRMED' ||
      (await this.audit.verify(id)).integrity !== 'VERIFIED'
    ) {
      throw new ApiException(
        503,
        'DEMO_AUDIT_PENDING',
        'Demo publication requires audit confirmation.',
      );
    }

    return this.repository.find(id);
  }

  async publish(
    id: string,
    externalItemId: 'base1-58' | 'base1-4',
    startsAt: Date,
    endsAt: Date,
    isDemo: boolean,
  ) {
    const key = this.key(id);
    const intent = await this.anchors.findOperation(key);

    // A lost main commit must never be treated as permission to publish the same slot again.
    if (intent && intent.state !== 'ABORTED') {
      return this.confirmed(id);
    }

    const prepared = this.fixtures.prepare(externalItemId);
    const input: CreateAuctionInput = {
      externalItemId,
      startingPriceCents: 1000,
      minimumIncrementCents: 100,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };
    const identity = {
      userId: DEMO_ACCOUNTS[0].id,
      operation: 'DEMO_PUBLISH',
      key: id,
      request: { ...input, isDemo },
    };
    let changed = false;
    const execution = await this.protocol.run(key, async (tx, prepare) => {
      await this.repository.lockCreation(tx);
      if (isDemo) {
        const active = await this.repository.open(tx);

        if (active && active.id !== id) {
          return { status: 200, resourceId: active.id, body: { auctionId: active.id } };
        }
      }

      const result = await this.idempotency.inTransaction<{ auctionId: string }>(
        tx,
        identity,
        async () => {
          if (await this.audit.lockedSnapshot(id, tx)) {
            throw new Error('Demo auction identifier already exists without its operation.');
          }

          const previous = isDemo ? await this.repository.latest(tx) : null;
          let item: { snapshotId: string; imageId: string };

          if (previous) {
            const source = (await this.audit.lockedSnapshot(previous.id, tx))!;

            await this.audit.requireConfirmed(source);
            item = { snapshotId: source.snapshotId, imageId: source.imageId };
          } else {
            item = await this.catalog.persist(prepared, tx);
          }

          await this.auctions.create(id, identity.userId, item, input, this.crypto.keyId, tx);
          await tx.auction.update({ where: { id }, data: { isDemo, createdAt: this.clock.now() } });

          const snapshot = (await this.audit.lockedSnapshot(id, tx))!;
          const head = this.crypto.genesis(snapshot);

          await this.auctions.setGenesis(id, head, tx);
          changed = true;

          return { status: 201, resourceId: id, body: { auctionId: id } };
        },
        key,
      );

      if (changed) {
        await prepare(id, null);
      }

      return result;
    });

    if (changed) {
      this.events.publish({
        auctionId: id,
        reason: execution.confirmation === 'CONFIRMED' ? 'PUBLISHED' : 'RECHECK',
      });
    }

    return this.confirmed(execution.value.body.auctionId);
  }
}
