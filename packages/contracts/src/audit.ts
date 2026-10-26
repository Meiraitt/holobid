import type { AuctionStatus, AuditIntegrity } from './auction';
import type { PublicBid } from './bid';
export type BidHistory = { items: PublicBid[]; nextCursor: string | null; version: number; serverTime: string };
export type PublicAudit = {
  auctionId: string; status: AuctionStatus | null; algorithmVersion: number | null; version: number | null;
  integrity: AuditIntegrity; checkedAt: string; verifiedThroughSequence: number; expectedCount: number | null;
  actualCount: number | null; firstInvalidSequence?: number; reasonCode: string; headHash: string | null;
  items: PublicBid[]; nextCursor: string | null;
};
