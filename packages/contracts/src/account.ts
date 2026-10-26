import type { OwnedAuctionDetail, PublicAuctionSummary } from './auction';
import type { WalletResponse } from './wallet';
export type ParticipationState = 'LEADING' | 'OUTBID' | 'WON' | 'LOST' | 'PROCESSING';
export type MyAuctionState = {
  auctionId: string; myPseudonym: string; rank: number | null; highestBidCents: number | null;
  isLeading: boolean; hasParticipated: boolean; reservedForThisAuctionCents: number; receiptCode: string | null;
  state: ParticipationState | 'NOT_PARTICIPATING'; settlementStatus: 'NOT_DUE' | 'PENDING' | 'COMPLETED' | 'FAILED';
};
export type Participation = MyAuctionState & { auction: PublicAuctionSummary };
export type ParticipationPage = { items: Participation[]; nextCursor: string | null; serverTime: string };
export type OwnedAuctionPage = { items: OwnedAuctionDetail[]; nextCursor: string | null; serverTime: string };
export type AuctioneerSummary = { totalReceivedCents: number; settledCount: number; withoutWinnerCount: number; wallet: WalletResponse };
