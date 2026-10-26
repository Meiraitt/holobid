import { Injectable } from '@nestjs/common';
import { DatabaseService, TransactionContext } from '../../database/database.service';

const publicUserSelect = { id: true, email: true, role: true } as const;

@Injectable()
export class SessionsRepository {
  constructor(private readonly database: DatabaseService) {}

  create(userId: string, refreshTokenHash: string, expiresAt: Date, tx: TransactionContext) {
    return tx.authSession.create({ data: { userId, refreshTokenHash, expiresAt } });
  }

  findByRefreshHash(refreshTokenHash: string) {
    return this.database.client.authSession.findUnique({ where: { refreshTokenHash },
      include: { user: { select: publicUserSelect } } });
  }

  findActive(id: string, userId: string) {
    return this.database.client.authSession.findFirst({
      where: { id, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, expiresAt: true, user: { select: publicUserSelect } },
    });
  }

  rotate(id: string, currentHash: string, nextHash: string, tx: TransactionContext) {
    return tx.authSession.updateMany({
      where: { id, refreshTokenHash: currentHash, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { refreshTokenHash: nextHash, rotationVersion: { increment: 1 } },
    });
  }

  revoke(id: string, userId: string, tx: TransactionContext) {
    return tx.authSession.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
