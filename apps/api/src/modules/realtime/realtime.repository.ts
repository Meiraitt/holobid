import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
@Injectable()
export class RealtimeRepository {
  constructor(private readonly database: DatabaseService) {}
  lot(id: string) { return this.database.client.auction.findUnique({ where: { id }, select: { id: true, version: true, lifecycle: true, startsAt: true, endsAt: true } }); }
  wallets(userIds: string[]) { return this.database.client.wallet.findMany({ where: { userId: { in: userIds } }, select: { userId: true, version: true } }); }
  affected(auctionId: string, connectedUsers: string[]) {
    return this.database.client.user.findMany({ where: { id: { in: connectedUsers }, OR: [{ auctions: { some: { id: auctionId } } }, { bids: { some: { auctionId } } }] }, select: { id: true } });
  }
}
