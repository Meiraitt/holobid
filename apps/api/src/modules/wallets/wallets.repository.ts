import { Injectable } from '@nestjs/common';
import { DatabaseService, TransactionContext } from '../../database/database.service';

@Injectable()
export class WalletsRepository {
  constructor(private readonly database: DatabaseService) {}

  findByUserId(userId: string, tx?: TransactionContext) {
    return (tx ?? this.database.client).wallet.findUnique({ where: { userId } });
  }

  create(userId: string, tx: TransactionContext) {
    return tx.wallet.create({ data: { userId } });
  }
}
