import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { canonicalJson, Json } from '../../common/canonical-json';
import type { ApiEnvironment } from '../../config/environment';
import type { Bid } from '../../generated/main/client';

import type { AuditHead, AuditSnapshot } from './audit.types';

@Injectable()
export class AuditCrypto {
  readonly keyId: string;

  readonly algorithmVersion = 1;

  private readonly signingKey: Buffer;

  private readonly identityKey: Buffer;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.keyId = config.get('AUDIT_KEY_ID', { infer: true });

    const signingSecret: string = config.get('AUDIT_HMAC_SECRET', { infer: true });
    const identitySecret: string = config.get('AUDIT_PSEUDONYM_SECRET', { infer: true });

    this.signingKey = Buffer.from(signingSecret, 'base64url');
    this.identityKey = Buffer.from(identitySecret, 'base64url');
  }

  digest(value: Json): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
  }

  mac(hash: string): string {
    return createHmac('sha256', this.signingKey)
      .update(canonicalJson(['holobid:mac', 1, this.keyId, hash]))
      .digest('hex');
  }

  validMac(hash: string, mac: string): boolean {
    return (
      /^[0-9a-f]{64}$/.test(hash) &&
      /^[0-9a-f]{64}$/.test(mac) &&
      timingSafeEqual(Buffer.from(this.mac(hash), 'hex'), Buffer.from(mac, 'hex'))
    );
  }

  pseudonym(auctionId: string, userId: string): string {
    return createHmac('sha256', this.identityKey)
      .update(canonicalJson(['holobid:pseudonym', 1, this.keyId, auctionId, userId]))
      .digest('hex')
      .slice(0, 16);
  }

  operationKey(userId: string, operation: string, key: string): string {
    const bytes = createHmac('sha256', this.signingKey)
      .update(
        canonicalJson(['holobid:operation', 1, this.keyId, userId, operation, key.toLowerCase()]),
      )
      .digest()
      .subarray(0, 16);

    bytes[6] = (bytes[6]! & 15) | 128;
    bytes[8] = (bytes[8]! & 63) | 128;

    const hex = bytes.toString('hex');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  genesis(auction: AuditSnapshot): AuditHead {
    const item = auction.snapshot;
    const image = auction.image;
    const hash = this.digest([
      'holobid:genesis',
      1,
      this.keyId,
      auction.id,
      auction.sellerId,
      auction.startingPriceCents.toString(),
      auction.minimumIncrementCents.toString(),
      auction.startsAt.toISOString(),
      auction.originalEndsAt.toISOString(),
      auction.isDemo,
      [
        item.id,
        item.provider,
        item.externalId,
        item.language,
        item.title,
        item.description,
        item.setId,
        item.setName,
        item.cardNumber,
        item.attributes as Json,
        item.fetchedAt.toISOString(),
      ],
      [image.id, image.sha256, image.mimeType, image.size],
    ]);

    return { sequence: 0, hash, mac: this.mac(hash), keyId: this.keyId, algorithmVersion: 1 };
  }

  bid(
    bid: Pick<
      Bid,
      | 'id'
      | 'auctionId'
      | 'bidderId'
      | 'sequence'
      | 'amountCents'
      | 'acceptedAt'
      | 'endsAtAfter'
      | 'previousHash'
    >,
  ) {
    const pseudonym = this.pseudonym(bid.auctionId, bid.bidderId);
    const hash = this.digest([
      'holobid:bid',
      1,
      this.keyId,
      bid.auctionId,
      bid.id,
      bid.sequence,
      pseudonym,
      bid.amountCents.toString(),
      bid.acceptedAt.toISOString(),
      bid.endsAtAfter.toISOString(),
      bid.previousHash,
    ]);

    return { pseudonym, hash, mac: this.mac(hash) };
  }
}
