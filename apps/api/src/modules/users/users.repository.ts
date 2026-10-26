import { Injectable } from '@nestjs/common';
import type { Role } from '../../generated/main/client';
import { DatabaseService, TransactionContext } from '../../database/database.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly database: DatabaseService) {}

  findByEmail(email: string, tx?: TransactionContext) {
    return (tx ?? this.database.client).user.findUnique({ where: { email } });
  }

  findById(id: string, tx?: TransactionContext) {
    return (tx ?? this.database.client).user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
  }

  create(input: { email: string; passwordHash: string; role: Role }, tx: TransactionContext) {
    return tx.user.create({ data: input });
  }
}
