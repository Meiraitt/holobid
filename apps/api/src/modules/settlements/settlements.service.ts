import { randomBytes, randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { ApiException } from '../../common/http/api.exception';
import { MAX_MONEY_CENTS } from '../../common/money';
import { DatabaseService } from '../../database/database.service';
import { presentDetail } from '../auctions/auction.presenter';
import { AuctionClock } from '../auctions/auction-clock';
import { AuctionEvents } from '../auctions/auction-events';
import { AuditService } from '../audit/audit.service';
import { BidsRepository } from '../bids/bids.repository';
import { WalletsRepository } from '../wallets/wallets.repository';

import { SettlementsRepository } from './settlements.repository';

export type SettlementResult = 'COMPLETED' | 'NOT_DUE' | 'IGNORED' | 'PENDING' | 'FAILED';

const permanent = new Set([
  'AUDIT_TAMPERED',
  'WALLET_INCONSISTENT',
  'RESERVATION_INCONSISTENT',
  'BALANCE_LIMIT_EXCEEDED',
]);

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly settlements: SettlementsRepository,
    private readonly audit: AuditService,
    private readonly bids: BidsRepository,
    private readonly wallets: WalletsRepository,
    private readonly clock: AuctionClock,
    private readonly events: AuctionEvents,
  ) {}

  async settle(auctionId: string): Promise<SettlementResult> {
    let changed = false;

    try {
      const result = await this.database.transaction(async (tx) => {
        const lot = await this.audit.lockedSnapshot(auctionId, tx);

        if (!lot || lot.lifecycle === 'CANCELLED') {
          return 'IGNORED';
        }

        if (lot.settlementStatus === 'COMPLETED') {
          return 'COMPLETED';
        }

        if (lot.settlementStatus === 'FAILED') {
          return 'FAILED';
        } // Requires investigation, not blind financial retries.

        if (this.clock.now() < lot.endsAt) {
          return 'NOT_DUE';
        }

        await this.audit.requireConfirmed(lot);

        const winner = lot.bids.at(-1);
        const locked = winner
          ? await this.wallets.lockManyChecked([lot.sellerId, winner.bidderId], tx)
          : null;
        const reservation = await this.bids.currentReservation(auctionId, winner, tx);
        const now = this.clock.now();

        if (now < lot.endsAt) {
          return 'NOT_DUE';
        }

        const existing = await this.settlements.find(auctionId, tx);
        const settlementId = existing?.id ?? randomUUID();

        if (winner) {
          if (winner.bidderId === lot.sellerId || !reservation) {
            throw new ApiException(
              409,
              'RESERVATION_INCONSISTENT',
              'Auction reservations require investigation.',
            );
          }

          const buyer = locked!.get(winner.bidderId)!;
          const seller = locked!.get(lot.sellerId)!;

          if (buyer.reservedCents < winner.amountCents || buyer.totalCents < winner.amountCents) {
            throw new ApiException(
              409,
              'WALLET_INCONSISTENT',
              'Wallet reservations require investigation.',
            );
          }

          if (seller.totalCents + winner.amountCents > BigInt(MAX_MONEY_CENTS)) {
            throw new ApiException(
              422,
              'BALANCE_LIMIT_EXCEEDED',
              'The seller balance would exceed the limit.',
            );
          }

          await this.wallets.move(
            winner.bidderId,
            'PURCHASE',
            settlementId,
            -winner.amountCents,
            -winner.amountCents,
            tx,
          );
          await this.wallets.move(lot.sellerId, 'SALE', settlementId, winner.amountCents, 0n, tx);
          await this.settlements.consume(reservation.id, tx);

          const detail = presentDetail(lot, now, 'VERIFIED');

          await this.settlements.receipt(
            {
              publicCode: randomBytes(24).toString('base64url'),
              auctionId,
              amountCents: winner.amountCents,
              issuedAt: now,
              winnerPseudonym: winner.pseudonym,
              finalHash: lot.auditHead,
              itemSnapshot: {
                title: detail.title,
                imageUrl: detail.imageUrl,
                setName: detail.setName,
                cardNumber: detail.cardNumber,
                attributes: detail.attributes,
                ...(detail.description ? { description: detail.description } : {}),
              },
            },
            tx,
          );
        }

        await this.settlements.complete(
          settlementId,
          auctionId,
          winner?.id ?? null,
          winner?.amountCents ?? 0n,
          now,
          tx,
        );
        await this.settlements.finish(auctionId, tx);
        changed = true;

        return 'COMPLETED';
      });

      if (changed) {
        this.events.publish({ auctionId, reason: 'ENDED' });
      }

      return result;
    } catch (error) {
      const code = error instanceof ApiException ? error.code : 'SETTLEMENT_UNAVAILABLE';

      this.logger.error({ event: 'settlement.failed', auctionId, code });
      // A lost COMMIT acknowledgement may already have completed the transfer.
      // Re-lock and check before recording failure; never overwrite a completed result.
      try {
        return await this.database.transaction(async (tx) => {
          const lot = await this.audit.lockedSnapshot(auctionId, tx);

          if (!lot || lot.lifecycle === 'CANCELLED') {
            return 'IGNORED';
          }

          if (lot.settlementStatus === 'COMPLETED') {
            return 'COMPLETED';
          }

          if (lot.settlementStatus === 'FAILED') {
            return 'FAILED';
          }

          if (this.clock.now() < lot.endsAt) {
            return 'NOT_DUE';
          }

          const status = permanent.has(code) ? 'FAILED' : 'PENDING';
          const winner = lot.bids.at(-1);

          await this.settlements.failure(
            auctionId,
            winner?.id ?? null,
            winner?.amountCents ?? 0n,
            status,
            code,
            tx,
          );

          return status;
        });
      } catch {
        return 'PENDING';
      } // A later scheduler pass rechecks durable state.
    }
  }
}
