import type { CatalogItem } from './catalog';
export type AuctionStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
export type AuditIntegrity = 'VERIFIED' | 'TAMPERED' | 'INCOMPLETE';
export type CreateAuctionInput = { externalItemId: string; startingPriceCents: number; minimumIncrementCents: number; startsAt: string; endsAt: string };
export type AuctionAttributes = Partial<Pick<CatalogItem, 'category' | 'rarity' | 'illustrator' | 'types' | 'hp'>>;
export type PublicAuctionSummary = {
  id: string; title: string; imageUrl: string; setName: string; cardNumber: string; status: AuctionStatus;
  startsAt: string; endsAt: string; startingPriceCents: number; currentBidCents: number | null;
  minimumNextBidCents: number | null; bidCount: number; version: number; serverTime: string;
};
export type AuctionOutcome = { kind: 'SOLD'; amountCents: number; winnerPseudonym: string; receiptCode: string } | { kind: 'NO_BIDS'; amountCents: 0 };
export type AuctionDetail = PublicAuctionSummary & {
  description?: string; attributes: AuctionAttributes; minimumIncrementCents: number; originalEndsAt: string;
  settlementStatus: 'NOT_DUE' | 'PENDING' | 'COMPLETED' | 'FAILED'; outcome?: AuctionOutcome;
  auditUrl: string; confirmation: 'CONFIRMED' | 'PENDING'; auditIntegrity: AuditIntegrity; canReceiveBids: boolean;
};
export type OwnedAuctionDetail = AuctionDetail & { canCancel: boolean; cancelReason: string | null };
export type AuctionPublicationPending = { confirmation: 'PENDING'; operationId: string; auctionId: string };
export type AuctionPage = { items: PublicAuctionSummary[]; nextCursor: string | null; serverTime: string };
