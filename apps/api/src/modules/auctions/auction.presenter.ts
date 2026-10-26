import type { AuctionAttributes, AuctionDetail, AuctionStatus, AuditIntegrity, OwnedAuctionDetail, PublicAuctionSummary } from '@holobid/contracts';
import type { Auction, CatalogSnapshot, Prisma, Receipt } from '../../generated/main/client';
import type { AuditSnapshot } from '../audit/audit.types';
import { MAX_MONEY_CENTS, moneyToNumber } from '../../common/money';

type SummarySource = Auction & { snapshot: CatalogSnapshot; currentBid: { amountCents: bigint } | null };
export function auctionStatus(auction: Pick<Auction, 'lifecycle' | 'startsAt' | 'endsAt'>, now: Date): AuctionStatus {
  if (auction.lifecycle === 'CANCELLED') return 'CANCELLED';
  if (auction.lifecycle === 'ENDED' || now >= auction.endsAt) return 'ENDED';
  return now < auction.startsAt ? 'SCHEDULED' : 'LIVE';
}
export function presentSummary(auction: SummarySource, now: Date): PublicAuctionSummary {
  const next = auction.currentBid ? auction.currentBid.amountCents + auction.minimumIncrementCents : auction.startingPriceCents;
  return { id: auction.id, title: auction.snapshot.title, imageUrl: `/api/v1/media/${auction.imageId}`, setName: auction.snapshot.setName,
    cardNumber: auction.snapshot.cardNumber, status: auctionStatus(auction, now), startsAt: auction.startsAt.toISOString(), endsAt: auction.endsAt.toISOString(),
    startingPriceCents: moneyToNumber(auction.startingPriceCents), currentBidCents: auction.currentBid ? moneyToNumber(auction.currentBid.amountCents) : null,
    minimumNextBidCents: next <= BigInt(MAX_MONEY_CENTS) ? moneyToNumber(next) : null, bidCount: auction.bidCount, version: auction.version, serverTime: now.toISOString() };
}
function attributes(value: Prisma.JsonValue): AuctionAttributes {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  const result: AuctionAttributes = {};
  if (value.category === 'Pokemon' || value.category === 'Trainer' || value.category === 'Energy') result.category = value.category;
  for (const field of ['rarity', 'illustrator'] as const) if (typeof value[field] === 'string' && value[field].length <= 256) result[field] = value[field];
  if (typeof value.hp === 'number' && Number.isSafeInteger(value.hp) && value.hp >= 0 && value.hp <= 100_000) result.hp = value.hp;
  if (Array.isArray(value.types) && value.types.length <= 10 && value.types.every(type => typeof type === 'string' && type.length <= 64)) result.types = value.types as string[];
  return result;
}
export function presentDetail(auction: AuditSnapshot, now: Date, integrity: AuditIntegrity, receipt: Receipt | null = null): AuctionDetail {
  const summary = presentSummary({ ...auction, currentBid: auction.bids.at(-1) ?? null }, now);
  const result: AuctionDetail = { ...summary, ...(auction.snapshot.description !== null ? { description: auction.snapshot.description } : {}),
    attributes: attributes(auction.snapshot.attributes), minimumIncrementCents: moneyToNumber(auction.minimumIncrementCents), originalEndsAt: auction.originalEndsAt.toISOString(),
    settlementStatus: auction.settlementStatus, auditUrl: `/api/v1/auctions/${auction.id}/audit`, confirmation: integrity === 'VERIFIED' ? 'CONFIRMED' : 'PENDING',
    auditIntegrity: integrity, canReceiveBids: summary.status === 'LIVE' && integrity === 'VERIFIED' && summary.minimumNextBidCents !== null };
  if (summary.status === 'ENDED' && auction.settlementStatus === 'COMPLETED') {
    if (receipt) result.outcome = { kind: 'SOLD', amountCents: moneyToNumber(receipt.amountCents), winnerPseudonym: receipt.winnerPseudonym, receiptCode: receipt.publicCode };
    else if (auction.bidCount === 0) result.outcome = { kind: 'NO_BIDS', amountCents: 0 };
  }
  return result;
}
export function presentOwned(detail: AuctionDetail): OwnedAuctionDetail {
  const reason = detail.status === 'CANCELLED' ? 'AUCTION_CANCELLED' : detail.status === 'ENDED' ? 'AUCTION_ENDED' : detail.bidCount > 0 ? 'AUCTION_HAS_BIDS'
    : detail.auditIntegrity === 'TAMPERED' ? 'AUDIT_TAMPERED' : detail.confirmation === 'PENDING' ? 'AUDIT_PENDING' : null;
  return { ...detail, canCancel: reason === null, cancelReason: reason };
}
