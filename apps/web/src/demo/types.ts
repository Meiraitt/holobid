export type DemoRole = 'bidder' | 'auctioneer';
export interface DemoUser {
  name: string;
  email: string;
  role: DemoRole;
}
export type AuctionStatus = 'live' | 'scheduled' | 'ended' | 'cancelled';
export type ParticipationStatus = 'leading' | 'outbid' | 'won' | 'lost' | 'pending';
export interface DemoCard {
  id: string;
  name: string;
  edition: string;
  number: string;
  rarity: string;
  image: string;
  types: string[];
  hp: number;
  illustrator: string;
}
export interface DemoBid {
  id: string;
  auctionId: string;
  amountCents: number;
  bidder: string;
  at: string;
  isMine: boolean;
}
export interface DemoAuction {
  id: string;
  card: DemoCard;
  status: AuctionStatus;
  startingBidCents: number;
  currentBidCents: number;
  incrementCents: number;
  bidCount: number;
  startsAt: string;
  endsAt: string;
  seller: string;
  mine: boolean;
  myBidCents?: number;
  position?: number;
  participation?: ParticipationStatus;
  settlement: 'none' | 'pending' | 'settled' | 'failed';
  integrity: 'verified' | 'pending' | 'tampered';
  receiptId?: string;
}
export interface CreateAuctionInput {
  cardId: string;
  startingBidCents: number;
  incrementCents: number;
  startsAt: string;
  endsAt: string;
}
export interface DemoState {
  user: DemoUser | null;
  auctions: DemoAuction[];
  bids: DemoBid[];
  totalCents: number;
}
