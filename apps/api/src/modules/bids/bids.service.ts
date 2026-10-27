import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { BidPending, BidResult } from '@holobid/contracts';

import { ApiException } from '../../common/http/api.exception';
import { RateLimitException } from '../../common/http/rate-limit.exception';
import { IdempotencyService, OperationResult } from '../../common/idempotency/idempotency.service';
import { MAX_MONEY_CENTS, moneyToNumber } from '../../common/money';
import { presentDetail } from '../auctions/auction.presenter';
import { AuctionClock } from '../auctions/auction-clock';
import { AuctionEvents } from '../auctions/auction-events';
import { auditUnavailable } from '../audit/audit.errors';
import { AuditService } from '../audit/audit.service';
import type { AuditHead } from '../audit/audit.types';
import { AuditAnchorRepository } from '../audit/audit-anchor.repository';
import { AuditCrypto } from '../audit/audit-crypto.service';
import { AuditProtocolService } from '../audit/audit-protocol.service';
import { presentWallet } from '../wallets/wallet.presenter';
import { WalletsRepository } from '../wallets/wallets.repository';

import { BidRateLimiter } from './bid-rate-limiter';
import { BidsRepository } from './bids.repository';

function pending(operationId: string, auctionId: string): OperationResult<BidPending> {
  return { status: 202, body: { operationId, auctionId, confirmation: 'PENDING' } };
}

@Injectable()
export class BidsService {
  constructor(
    private readonly bids: BidsRepository,
    private readonly wallets: WalletsRepository,
    private readonly idempotency: IdempotencyService,
    private readonly crypto: AuditCrypto,
    private readonly anchors: AuditAnchorRepository,
    private readonly audit: AuditService,
    private readonly protocol: AuditProtocolService,
    private readonly clock: AuctionClock,
    private readonly limiter: BidRateLimiter,
    private readonly events: AuctionEvents,
  ) {}

  private async resolve(
    result: OperationResult<BidResult>,
    operationKey: string,
    auctionId: string,
  ) {
    return (await this.audit.reconcile(operationKey)) === 'CONFIRMED'
      ? result
      : pending(operationKey, auctionId);
  }

  async place(
    userId: string,
    auctionId: string,
    key: string,
    amountCents: number,
  ): Promise<OperationResult<BidResult | BidPending>> {
    const operation = `POST /auctions/${auctionId}/bids`;
    const identity = { userId, operation, key, request: { amountCents } };
    const operationKey = this.crypto.operationKey(userId, operation, key);
    const existing = await this.idempotency.find<BidResult>(identity);

    if (existing) {
      return this.resolve(existing, operationKey, auctionId);
    }

    let intent;

    try {
      intent = await this.anchors.findOperation(operationKey);
    } catch {
      throw auditUnavailable();
    }

    if (intent && intent.state !== 'ABORTED') {
      if (intent.requestHash !== this.idempotency.fingerprint(identity.request)) {
        throw new ApiException(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'This key was used with a different request.',
        );
      }

      await this.audit.reconcile(operationKey);

      const recovered = await this.idempotency.find<BidResult>(identity);

      return recovered
        ? this.resolve(recovered, operationKey, auctionId)
        : pending(operationKey, auctionId);
    }

    let changed = false;
    let extended = false;
    let expectedHead: AuditHead | undefined;
    const execution = await this.protocol.run(operationKey, async (tx, prepare) => {
      const result = await this.idempotency.inTransaction<BidResult>(
        tx,
        identity,
        async () => {
          const retryAfter = this.limiter.consume(userId);

          if (retryAfter !== null) {
            throw new RateLimitException(retryAfter);
          }

          const snapshot = await this.audit.lockedSnapshot(auctionId, tx);

          if (!snapshot) {
            throw new ApiException(404, 'AUCTION_NOT_FOUND', 'Auction not found.');
          }

          if (snapshot.sellerId === userId) {
            throw new ApiException(403, 'ROLE_FORBIDDEN', 'Auction owners cannot bid.');
          }

          if (snapshot.lifecycle === 'CANCELLED') {
            throw new ApiException(409, 'AUCTION_CANCELLED', 'The auction was cancelled.');
          }

          const observedAt = this.clock.now();

          if (snapshot.lifecycle === 'ENDED' || observedAt >= snapshot.endsAt) {
            throw new ApiException(409, 'AUCTION_ENDED', 'The auction has ended.');
          }

          if (observedAt < snapshot.startsAt) {
            throw new ApiException(409, 'AUCTION_NOT_STARTED', 'The auction has not started.');
          }

          const leader = snapshot.bids.at(-1);

          if (leader?.bidderId === userId) {
            throw new ApiException(409, 'ALREADY_LEADING', 'You are already leading this auction.');
          }

          const minimum = leader
            ? leader.amountCents + snapshot.minimumIncrementCents
            : snapshot.startingPriceCents;

          if (minimum > BigInt(MAX_MONEY_CENTS)) {
            throw new ApiException(
              409,
              'BID_LIMIT_REACHED',
              'No further bid fits the monetary limit.',
            );
          }

          if (BigInt(amountCents) < minimum) {
            throw new ApiException(409, 'BID_BELOW_MINIMUM', 'The bid is below the minimum.', {
              minimumBidCents: moneyToNumber(minimum),
            });
          }

          expectedHead = await this.audit.requireConfirmed(snapshot);

          const locked = await this.wallets.lockManyChecked(
            [userId, ...(leader ? [leader.bidderId] : [])],
            tx,
          );
          const reservation = await this.bids.currentReservation(auctionId, leader, tx);
          const acceptedAt = this.clock.now(); // Revalidate time after every contended lock and audit read.

          if (acceptedAt >= snapshot.endsAt) {
            throw new ApiException(409, 'AUCTION_ENDED', 'The auction has ended.');
          }

          if (acceptedAt < snapshot.startsAt) {
            throw new ApiException(409, 'AUCTION_NOT_STARTED', 'The auction has not started.');
          }

          const wallet = locked.get(userId)!;
          const amount = BigInt(amountCents);

          if (wallet.totalCents - wallet.reservedCents < amount) {
            throw new ApiException(422, 'INSUFFICIENT_FUNDS', 'Insufficient available balance.');
          }

          const endsAtAfter =
            snapshot.endsAt.getTime() - acceptedAt.getTime() <= 120_000
              ? new Date(acceptedAt.getTime() + 120_000)
              : snapshot.endsAt;

          extended = endsAtAfter > snapshot.endsAt;

          const value = {
            id: randomUUID(),
            auctionId,
            bidderId: userId,
            sequence: snapshot.bidCount + 1,
            amountCents: amount,
            acceptedAt,
            endsAtAfter,
            previousHash: snapshot.auditHead,
          };

          await this.audit.assertPseudonymAvailable(auctionId, userId, tx);

          const bid = { ...value, ...this.crypto.bid(value) };

          if (reservation) {
            await this.bids.release(reservation.id, tx);
            await this.wallets.move(
              reservation.userId,
              'RELEASE',
              bid.id,
              0n,
              -reservation.amountCents,
              tx,
            );
          }

          const updatedWallet = await this.wallets.move(userId, 'RESERVE', bid.id, 0n, amount, tx);
          const updated = await this.bids.accept(bid, tx);

          changed = true;

          return {
            status: 201,
            resourceId: bid.id,
            body: {
              operationId: operationKey,
              confirmation: 'CONFIRMED',
              bid: {
                id: bid.id,
                sequence: bid.sequence,
                amountCents,
                acceptedAt: acceptedAt.toISOString(),
                bidderPseudonym: bid.pseudonym,
              },
              auction: presentDetail(
                { ...snapshot, ...updated, bids: [...snapshot.bids, bid] },
                acceptedAt,
                'VERIFIED',
              ),
              wallet: presentWallet(updatedWallet, acceptedAt),
            },
          };
        },
        operationKey,
      );

      if (changed) {
        await prepare(auctionId, expectedHead!);
      }

      return result;
    });

    if (changed) {
      this.events.publish({
        auctionId,
        reason: execution.confirmation === 'CONFIRMED' ? 'BID_ACCEPTED' : 'RECHECK',
        ...(extended && execution.confirmation === 'CONFIRMED' ? { extended: true } : {}),
      });
    }

    if (execution.confirmation === 'CONFIRMED') {
      return execution.value;
    }

    if (!changed) {
      return this.resolve(execution.value, operationKey, auctionId);
    }

    return pending(operationKey, auctionId);
  }
}
