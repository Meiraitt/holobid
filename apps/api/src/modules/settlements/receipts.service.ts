import { Injectable } from '@nestjs/common';

import type { PublicReceipt } from '@holobid/contracts';

import { ApiException } from '../../common/http/api.exception';
import { moneyToNumber } from '../../common/money';
import { DatabaseService } from '../../database/database.service';
import { auctionAttributes } from '../auctions/auction.presenter';

@Injectable()
export class ReceiptsService {
  constructor(private readonly database: DatabaseService) {}

  async get(publicCode: string): Promise<PublicReceipt> {
    const notFound = () => new ApiException(404, 'RECEIPT_NOT_FOUND', 'Receipt not found.');

    if (!/^[A-Za-z0-9_-]{32}$/.test(publicCode)) {
      throw notFound();
    }

    const receipt = await this.database.client.receipt.findUnique({ where: { publicCode } });

    if (!receipt) {
      throw notFound();
    }

    const item = receipt.itemSnapshot;

    if (!item || Array.isArray(item) || typeof item !== 'object') {
      throw new ApiException(503, 'RECEIPT_UNAVAILABLE', 'Receipt unavailable.');
    }

    const text = (name: string) => {
      const value = item[name];

      if (typeof value !== 'string') {
        throw new ApiException(503, 'RECEIPT_UNAVAILABLE', 'Receipt unavailable.');
      }

      return value;
    };

    return {
      publicCode,
      auctionId: receipt.auctionId,
      title: text('title'),
      imageUrl: text('imageUrl'),
      setName: text('setName'),
      cardNumber: text('cardNumber'),
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      attributes: auctionAttributes(item.attributes ?? null),
      amountCents: moneyToNumber(receipt.amountCents),
      settledAt: receipt.issuedAt.toISOString(),
      winnerPseudonym: receipt.winnerPseudonym,
      finalAuditHash: receipt.finalHash,
      auditUrl: `/api/v1/auctions/${receipt.auctionId}/audit`,
    };
  }
}
