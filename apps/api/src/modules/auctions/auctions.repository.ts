import { Injectable } from '@nestjs/common';
import { DatabaseService, TransactionContext } from '../../database/database.service';

@Injectable()
export class AuctionsRepository {
  constructor(private readonly database: DatabaseService) {}

  findOwnedById(id: string, sellerId: string, tx?: TransactionContext) {
    return (tx ?? this.database.client).auction.findFirst({ where: { id, sellerId } });
  }
}
