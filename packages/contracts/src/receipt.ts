import type { AuctionAttributes } from './auction';
export type PublicReceipt = { publicCode: string; auctionId: string; title: string; imageUrl: string; setName: string; cardNumber: string;
  description?: string; attributes: AuctionAttributes; amountCents: number; settledAt: string; winnerPseudonym: string; finalAuditHash: string; auditUrl: string };
