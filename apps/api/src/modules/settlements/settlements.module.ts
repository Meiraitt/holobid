import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { BidsModule } from '../bids/bids.module';
import { WalletPersistenceModule } from '../wallets/wallet-persistence.module';
import { SettlementsRepository } from './settlements.repository';
import { SettlementsService } from './settlements.service';
import { AuctionScheduler } from './auction-scheduler';
import { ReceiptsService } from './receipts.service';
import { ReceiptsController } from './receipts.controller';
@Module({ imports: [DatabaseModule, AuditModule, AuctionsModule, BidsModule, WalletPersistenceModule], controllers: [ReceiptsController],
  providers: [SettlementsRepository, SettlementsService, AuctionScheduler, ReceiptsService], exports: [SettlementsService, AuctionScheduler] })
export class SettlementsModule {}
