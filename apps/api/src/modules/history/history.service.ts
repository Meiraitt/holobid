import { Injectable } from '@nestjs/common';
import type { BidHistory, PublicAudit, PublicBid } from '@holobid/contracts';
import { ApiException } from '../../common/http/api.exception';
import { moneyToNumber } from '../../common/money';
import { PageQueryDto } from '../../common/pagination/page-query.dto';
import { SignedCursorService } from '../../common/pagination/signed-cursor.service';
import { DatabaseService } from '../../database/database.service';
import type { Bid } from '../../generated/main/client';
import { AuditService } from '../audit/audit.service';
import { AuctionClock } from '../auctions/auction-clock';
import { auctionStatus } from '../auctions/auction.presenter';

@Injectable()
export class HistoryService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService,
    private readonly clock: AuctionClock, private readonly cursors: SignedCursorService) {}
  private position(query: PageQueryDto, scope: string): number | undefined {
    const decoded = this.cursors.decode(query.cursor, scope);
    if (!decoded) return undefined;
    const sequence = Number(decoded[0]);
    if (decoded.length !== 1 || !/^[1-9]\d*$/.test(decoded[0]!) || !Number.isSafeInteger(sequence)) return this.cursors.invalid();
    return sequence;
  }
  private page(bids: Bid[], limit: number, before: number | undefined, scope: string) {
    const selected = bids.filter(bid => before === undefined || bid.sequence < before).reverse().slice(0, limit + 1);
    const rows = selected.slice(0, limit);
    const items: PublicBid[] = rows.map(bid => ({ id: bid.id, sequence: bid.sequence, amountCents: moneyToNumber(bid.amountCents),
      acceptedAt: bid.acceptedAt.toISOString(), bidderPseudonym: bid.pseudonym }));
    return { items, nextCursor: selected.length > limit ? this.cursors.encode(scope, [String(rows.at(-1)!.sequence)]) : null };
  }
  async history(auctionId: string, query: PageQueryDto): Promise<BidHistory> {
    const scope = `history:${auctionId}`, before = this.position(query, scope);
    return this.read(async () => this.database.transaction(async tx => {
      const lot = await this.audit.lockedSnapshot(auctionId, tx);
      if (!lot) throw new ApiException(404, 'AUCTION_NOT_FOUND', 'Auction not found.');
      return { ...this.page(lot.bids, query.limit, before, scope), version: lot.version, serverTime: this.clock.now().toISOString() };
    }));
  }
  async verify(auctionId: string, query: PageQueryDto): Promise<PublicAudit> {
    const scope = `audit:${auctionId}`, before = this.position(query, scope);
    return this.read(async () => this.database.transaction(async tx => {
      // Hold the same auction lock as writers until both sources have been read.
      const lot = await this.audit.lockedSnapshot(auctionId, tx);
      const result = await this.audit.verifyLocked(lot, auctionId);
      if (!lot && result.reasonCode === 'ANCHOR_MISSING') throw new ApiException(404, 'AUCTION_NOT_FOUND', 'Auction not found.');
      if (!lot && result.reasonCode === 'DEPENDENCY_UNAVAILABLE') throw new ApiException(503, 'AUDIT_UNAVAILABLE', 'Audit data is temporarily unavailable.');
      return { auctionId, status: lot ? auctionStatus(lot, this.clock.now()) : null, algorithmVersion: lot?.auditVersion ?? null,
        version: lot?.version ?? null, checkedAt: this.clock.now().toISOString(), ...result,
        ...this.page(lot?.bids ?? [], query.limit, before, scope) };
    }));
  }
  private async read<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof ApiException) throw error;
      throw new ApiException(503, 'AUDIT_UNAVAILABLE', 'Audit data is temporarily unavailable.');
    }
  }
}
