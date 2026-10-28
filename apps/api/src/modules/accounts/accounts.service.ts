import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import type {
  AuctioneerSummary,
  MyAuctionState,
  OwnedAuctionPage,
  ParticipationPage,
} from '@holobid/contracts';

import { ApiException } from '../../common/http/api.exception';
import { moneyToNumber } from '../../common/money';
import { SignedCursorService } from '../../common/pagination/signed-cursor.service';
import { DatabaseService, TransactionContext } from '../../database/database.service';
import { presentDetail, presentOwned, presentSummary } from '../auctions/auction.presenter';
import { AuctionClock } from '../auctions/auction-clock';
import { AuditService } from '../audit/audit.service';
import { AuditCrypto } from '../audit/audit-crypto.service';
import { presentWallet } from '../wallets/wallet.presenter';
import { WalletsRepository } from '../wallets/wallets.repository';

import { OwnedAuctionQueryDto, ParticipationQueryDto } from './account.dto';
import { presentMyAuction } from './account.presenter';
import { AccountPagePosition, AccountsRepository } from './accounts.repository';

// Verification loads original image bytes; bound memory even for a 100-item page.
const OWNER_AUDIT_BATCH_SIZE = 12;

@Injectable()
export class AccountsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accounts: AccountsRepository,
    private readonly crypto: AuditCrypto,
    private readonly audit: AuditService,
    private readonly wallets: WalletsRepository,
    private readonly clock: AuctionClock,
    private readonly cursors: SignedCursorService,
  ) {}

  private position(cursor: string | undefined, scope: string): AccountPagePosition | undefined {
    const decoded = this.cursors.decode(cursor, scope);

    if (!decoded) {
      return undefined;
    }

    const [timestamp, id] = decoded;

    if (decoded.length !== 2 || !timestamp || !id || !isUUID(id, '4')) {
      return this.cursors.invalid();
    }

    const createdAt = new Date(timestamp);

    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== timestamp) {
      return this.cursors.invalid();
    }

    return { createdAt, id };
  }

  private next(rows: AccountPagePosition[], limit: number, scope: string) {
    const last = rows[limit - 1];

    return rows.length > limit && last
      ? this.cursors.encode(scope, [last.createdAt.toISOString(), last.id])
      : null;
  }

  myAuction(userId: string, id: string): Promise<MyAuctionState> {
    return this.database.readSnapshot(async (tx) => {
      const lot = await this.accounts.auction(id, tx);

      if (!lot || lot.lifecycle === 'CANCELLED') {
        throw new ApiException(404, 'AUCTION_NOT_FOUND', 'Auction not found.');
      }

      const ranks = await this.accounts.ranks([id], tx);
      const reservations = await this.accounts.reservations([id], userId, tx);

      return presentMyAuction(
        lot,
        userId,
        this.crypto.pseudonym(id, userId),
        ranks,
        reservations[0]?.amountCents ?? 0n,
        this.clock.now(),
      );
    });
  }

  participations(userId: string, query: ParticipationQueryDto): Promise<ParticipationPage> {
    const scope = `participations:${userId}:${query.filter}`;
    const position = this.position(query.cursor, scope);

    return this.database.readSnapshot(async (tx) => {
      const now = this.clock.now();
      const rows = await this.accounts.participations(
        userId,
        query.filter,
        now,
        query.limit + 1,
        position,
        tx,
      );
      const page = rows.slice(0, query.limit);
      const ids = page.map((row) => row.id);
      const ranks = await this.accounts.ranks(ids, tx);
      const reservations = await this.accounts.reservations(ids, userId, tx);

      return {
        items: page.map((lot) => ({
          auction: presentSummary(lot, now),
          ...presentMyAuction(
            lot,
            userId,
            this.crypto.pseudonym(lot.id, userId),
            ranks,
            reservations.find((row) => row.auctionId === lot.id)?.amountCents ?? 0n,
            now,
          ),
        })),
        nextCursor: this.next(rows, query.limit, scope),
        serverTime: now.toISOString(),
      };
    });
  }

  owned(userId: string, query: OwnedAuctionQueryDto): Promise<OwnedAuctionPage> {
    const scope = `owned:${userId}:${query.status ?? 'ALL'}`;
    const position = this.position(query.cursor, scope);

    return this.database.transaction(async (tx) => {
      const now = this.clock.now();
      const rows = await this.accounts.lockOwnedPage(
        userId,
        query.status,
        now,
        query.limit + 1,
        position,
        tx,
      );
      const page = rows.slice(0, query.limit);
      const items: OwnedAuctionPage['items'] = [];

      for (let offset = 0; offset < page.length; offset += OWNER_AUDIT_BATCH_SIZE) {
        const ids = page.slice(offset, offset + OWNER_AUDIT_BATCH_SIZE).map((row) => row.id);

        items.push(...(await this.ownedBatch(userId, ids, now, tx)));
      }

      return {
        items,
        nextCursor: this.next(rows, query.limit, scope),
        serverTime: now.toISOString(),
      };
    });
  }

  private async ownedBatch(
    userId: string,
    ids: string[],
    now: Date,
    tx: TransactionContext,
  ): Promise<OwnedAuctionPage['items']> {
    const snapshots = await this.audit.readLockedSnapshots(ids, tx);
    const byAuction = new Map(snapshots.map((lot) => [lot.id, lot]));
    const results = await this.audit.verifyLockedBatch(snapshots);
    const receipts = await this.accounts.receipts(ids, tx);
    const byReceipt = new Map(receipts.map((receipt) => [receipt.auctionId, receipt]));

    return ids.map((id) => {
      const lot = byAuction.get(id);

      if (!lot || lot.sellerId !== userId) {
        throw new ApiException(404, 'AUCTION_NOT_FOUND', 'Auction not found.');
      }

      const result = results.get(lot.id)!;

      return presentOwned(presentDetail(lot, now, result.integrity, byReceipt.get(lot.id) ?? null));
    });
  }

  summary(userId: string): Promise<AuctioneerSummary> {
    return this.database.readSnapshot(async (tx) => {
      const sales = await this.accounts.completedSales(userId, tx);
      const withoutWinnerCount = await this.accounts.withoutWinner(userId, tx);
      const wallet = await this.wallets.findByUserId(userId, tx);

      if (!wallet) {
        throw new Error('Wallet invariant violated.');
      }

      return {
        totalReceivedCents: moneyToNumber(sales._sum.amountCents ?? 0n),
        settledCount: sales._count,
        withoutWinnerCount,
        wallet: presentWallet(wallet, this.clock.now()),
      };
    });
  }
}
