import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/http/api.exception';
import type { TransactionContext } from '../../database/database.service';
import { AuctionsRepository } from './auctions.repository';

@Injectable()
export class AuctionOwnershipService {
  constructor(private readonly auctions: AuctionsRepository) {}

  async requireOwned(auctionId: string, sellerId: string, tx?: TransactionContext) {
    const auction = await this.auctions.findOwnedById(auctionId, sellerId, tx);
    if (!auction) throw new ApiException(404, 'AUCTION_NOT_FOUND', 'Auction not found.');
    return auction;
  }
}
