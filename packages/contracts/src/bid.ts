import type { AuctionDetail } from './auction';
import type { WalletResponse } from './wallet';

export type BidInput = { amountCents: number };
export type PublicBid = {
  id: string;
  sequence: number;
  amountCents: number;
  acceptedAt: string;
  bidderPseudonym: string;
};
export type BidResult = {
  operationId: string;
  confirmation: 'CONFIRMED';
  bid: PublicBid;
  auction: AuctionDetail;
  wallet: WalletResponse;
};
export type BidPending = { operationId: string; auctionId: string; confirmation: 'PENDING' };
