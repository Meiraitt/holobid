import { Injectable } from '@nestjs/common';

import type { AuctionPage, OwnedAuctionDetail } from '@holobid/contracts';

import { ApiException } from '../../common/http/api.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/main/client';
import { AuditService } from '../audit/audit.service';

import { AuctionQueryDto } from './auction.dto';
import { auctionStatus, presentDetail, presentOwned, presentSummary } from './auction.presenter';
import { AuctionClock } from './auction-clock';
import { AuctionCursorService } from './auction-cursor.service';
import { AuctionEvents } from './auction-events';
import { AuctionsRepository } from './auctions.repository';

function notFound() {
  return new ApiException(404, 'AUCTION_NOT_FOUND', 'Auction not found.');
}

@Injectable()
export class AuctionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auctions: AuctionsRepository,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly clock: AuctionClock,
    private readonly cursors: AuctionCursorService,
    private readonly events: AuctionEvents,
  ) {}

  async list(query: AuctionQueryDto): Promise<AuctionPage> {
    const now = this.clock.now();
    const cursor = this.cursors.decode(query.cursor, query.status);
    const filters: Prisma.AuctionWhereInput[] = [{ lifecycle: { not: 'CANCELLED' } }];

    if (query.status === 'SCHEDULED') {
      filters.push({ lifecycle: 'OPEN', startsAt: { gt: now } });
    }

    if (query.status === 'LIVE') {
      filters.push({ lifecycle: 'OPEN', startsAt: { lte: now }, endsAt: { gt: now } });
    }

    if (query.status === 'ENDED') {
      filters.push({ OR: [{ lifecycle: 'ENDED' }, { endsAt: { lte: now } }] });
    }

    if (cursor) {
      filters.push({
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      });
    }

    const rows = await this.auctions.list({ AND: filters }, query.limit + 1);
    const page = rows.slice(0, query.limit);

    return {
      items: page.map((row) => presentSummary(row, now)),
      nextCursor:
        rows.length > query.limit ? this.cursors.encode(page.at(-1)!, query.status) : null,
      serverTime: now.toISOString(),
    };
  }

  detail(id: string) {
    return this.database.transaction(async (tx) => {
      const snapshot = await this.audit.lockedSnapshot(id, tx);

      if (!snapshot || snapshot.lifecycle === 'CANCELLED') {
        throw notFound();
      }

      const integrity = await this.audit.verifyLocked(snapshot, id);
      const receipt = await this.auctions.receipt(id, tx);

      return presentDetail(snapshot, this.clock.now(), integrity.integrity, receipt);
    });
  }

  async cancel(userId: string, id: string, key: string) {
    const result = await this.idempotency.execute<OwnedAuctionDetail>(
      { userId, key, operation: `POST /auctions/${id}/cancel`, request: {} },
      async (tx) => {
        const snapshot = await this.audit.lockedSnapshot(id, tx);

        if (!snapshot || snapshot.sellerId !== userId) {
          throw notFound();
        }

        if (snapshot.lifecycle === 'CANCELLED') {
          const integrity = await this.audit.verifyLocked(snapshot, id);

          return {
            status: 200,
            resourceId: id,
            body: presentOwned(presentDetail(snapshot, this.clock.now(), integrity.integrity)),
          };
        }

        if (snapshot.bidCount > 0 || snapshot.bids.length > 0) {
          throw new ApiException(
            409,
            'AUCTION_HAS_BIDS',
            'An auction with bids cannot be cancelled.',
          );
        }

        await this.audit.requireConfirmed(snapshot);

        const now = this.clock.now();

        if (auctionStatus(snapshot, now) === 'ENDED') {
          throw new ApiException(409, 'AUCTION_ENDED', 'The auction has already ended.');
        }

        const updated = await this.auctions.cancel(id, tx);

        return {
          status: 200,
          resourceId: id,
          body: presentOwned(presentDetail({ ...snapshot, ...updated }, now, 'VERIFIED')),
        };
      },
    );

    this.events.publish({ auctionId: id, reason: 'CANCELLED' });

    return result;
  }
}
