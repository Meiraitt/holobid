import { Injectable } from '@nestjs/common';

import { ApiException } from '../../common/http/api.exception';
import type { TransactionContext } from '../../database/database.service';
import type { Bid, Reservation } from '../../generated/main/client';

@Injectable()
export class BidsRepository {
  async currentReservation(
    auctionId: string,
    leader: Bid | undefined,
    tx: TransactionContext,
  ): Promise<Reservation | null> {
    const active = await tx.reservation.findFirst({ where: { auctionId, status: 'ACTIVE' } });

    if (
      leader
        ? !active ||
          active.bidId !== leader.id ||
          active.userId !== leader.bidderId ||
          active.amountCents !== leader.amountCents
        : active !== null
    ) {
      throw new ApiException(
        409,
        'RESERVATION_INCONSISTENT',
        'Auction reservations require investigation.',
      );
    }

    return active;
  }

  release(id: string, tx: TransactionContext) {
    return tx.reservation.update({ where: { id }, data: { status: 'RELEASED' } });
  }

  async accept(bid: Bid, tx: TransactionContext) {
    await tx.bid.create({ data: bid });
    await tx.reservation.create({
      data: {
        auctionId: bid.auctionId,
        bidId: bid.id,
        userId: bid.bidderId,
        amountCents: bid.amountCents,
      },
    });

    return tx.auction.update({
      where: { id: bid.auctionId },
      data: {
        currentBidId: bid.id,
        bidCount: bid.sequence,
        auditHead: bid.hash,
        auditMac: bid.mac,
        endsAt: bid.endsAtAfter,
        version: { increment: 1 },
      },
    });
  }
}
