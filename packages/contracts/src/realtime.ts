import type { AuctionStatus } from './auction';

export type AuctionEventReason =
  'BID_ACCEPTED' | 'EXTENDED' | 'STARTED' | 'ENDED' | 'CANCELLED' | 'AUDIT_CONFIRMED';
export type AuctionUpdated = {
  eventId: string;
  auctionId: string;
  auctionVersion: number;
  reason: AuctionEventReason;
  serverTime: string;
};
export type CatalogUpdated = {
  eventId: string;
  auctionId: string;
  auctionVersion: number;
  status: AuctionStatus;
  serverTime: string;
};
export type WalletUpdated = { eventId: string; walletVersion: number; serverTime: string };
export type ParticipationUpdated = { eventId: string; auctionId: string; serverTime: string };
export type SubscriptionAck =
  | { ok: true; auctionVersion?: number; serverTime: string }
  | {
      ok: false;
      code: 'VALIDATION_ERROR' | 'AUCTION_NOT_FOUND' | 'LIMIT_EXCEEDED' | 'UNAVAILABLE';
    };
export interface ServerToClientEvents {
  'auction.updated': (event: AuctionUpdated) => void;
  'catalog.updated': (event: CatalogUpdated) => void;
  'wallet.updated': (event: WalletUpdated) => void;
  'participation.updated': (event: ParticipationUpdated) => void;
  'session.revoked': (event: { reason: 'LOGOUT' }) => void;
  'auth.expired': (event: { reason: 'TOKEN_EXPIRED' }) => void;
}
export interface ClientToServerEvents {
  'auction.subscribe': (
    input: { auctionId: string },
    ack: (result: SubscriptionAck) => void,
  ) => void;
  'auction.unsubscribe': (
    input: { auctionId: string },
    ack: (result: SubscriptionAck) => void,
  ) => void;
}
