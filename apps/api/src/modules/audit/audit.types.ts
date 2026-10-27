import type { Auction, Bid, CatalogSnapshot, MediaAsset } from '../../generated/main/client';

export type AuditSnapshot = Auction & { bids: Bid[]; snapshot: CatalogSnapshot; image: MediaAsset };
export type AuditHead = {
  sequence: number;
  hash: string;
  mac: string;
  keyId: string;
  algorithmVersion: number;
};
export type AuditProposal = {
  attemptId: string;
  operationKey: string;
  auctionId: string;
  expected: AuditHead | null;
  next: AuditHead;
  proofHash: string;
  requestHash?: string;
};
export type AuditVerdict = {
  integrity: 'VERIFIED' | 'TAMPERED' | 'INCOMPLETE';
  reasonCode: string;
  expectedCount: number | null;
  actualCount: number | null;
  verifiedThroughSequence: number;
  headHash: string | null;
  firstInvalidSequence?: number;
};
export function verdict(
  integrity: AuditVerdict['integrity'],
  reasonCode: string,
  expectedCount: number | null = null,
  actualCount: number | null = null,
): AuditVerdict {
  return {
    integrity,
    reasonCode,
    expectedCount,
    actualCount,
    verifiedThroughSequence: 0,
    headHash: null,
  };
}

export function snapshotHead(snapshot: AuditSnapshot): AuditHead {
  return {
    sequence: snapshot.bidCount,
    hash: snapshot.auditHead,
    mac: snapshot.auditMac,
    keyId: snapshot.auditKeyId,
    algorithmVersion: snapshot.auditVersion,
  };
}
