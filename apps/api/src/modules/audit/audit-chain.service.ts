import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditCrypto } from './audit-crypto.service';
import { AuditSnapshot, AuditVerdict, verdict } from './audit.types';

@Injectable()
export class AuditChainService {
  constructor(private readonly crypto: AuditCrypto) {}
  verify(snapshot: AuditSnapshot): AuditVerdict {
    const actual = snapshot.bids.length;
    if (snapshot.auditVersion !== this.crypto.algorithmVersion || snapshot.auditKeyId !== this.crypto.keyId) {
      return verdict('INCOMPLETE', 'KEY_OR_VERSION_UNAVAILABLE', null, actual);
    }
    if (createHash('sha256').update(snapshot.image.bytes).digest('hex') !== snapshot.image.sha256) return verdict('TAMPERED', 'IMAGE_MISMATCH', null, actual);
    let head = this.crypto.genesis(snapshot);
    let lastId: string | null = null;
    let endsAt = snapshot.originalEndsAt;
    const identities = new Map<string, string>();
    for (const bid of snapshot.bids) {
      const signed = this.crypto.bid(bid);
      const collision = identities.has(signed.pseudonym) && identities.get(signed.pseudonym) !== bid.bidderId;
      if (bid.auctionId !== snapshot.id || bid.sequence !== head.sequence + 1 || bid.previousHash !== head.hash ||
          bid.hash !== signed.hash || bid.pseudonym !== signed.pseudonym || !this.crypto.validMac(bid.hash, bid.mac) || collision) {
        return { ...verdict('TAMPERED', 'BID_CHAIN_MISMATCH', snapshot.bidCount, actual), verifiedThroughSequence: head.sequence, firstInvalidSequence: head.sequence + 1 };
      }
      identities.set(signed.pseudonym, bid.bidderId);
      head = { ...head, sequence: bid.sequence, hash: bid.hash, mac: bid.mac };
      lastId = bid.id; endsAt = bid.endsAtAfter;
    }
    if (snapshot.bidCount !== head.sequence || snapshot.auditHead !== head.hash || snapshot.auditMac !== head.mac ||
        snapshot.currentBidId !== lastId || snapshot.endsAt.getTime() !== endsAt.getTime()) {
      return { ...verdict('TAMPERED', 'AUCTION_HEAD_MISMATCH', snapshot.bidCount, actual), verifiedThroughSequence: head.sequence };
    }
    return { ...verdict('VERIFIED', 'CHAIN_VALID', head.sequence, actual), verifiedThroughSequence: head.sequence, headHash: head.hash };
  }
}
