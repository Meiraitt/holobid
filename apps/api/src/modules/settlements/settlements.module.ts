import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { SettlementCoreModule } from './settlement-core.module';
import { AuctionScheduler } from './auction-scheduler';
import { ReceiptsService } from './receipts.service';
import { ReceiptsController } from './receipts.controller';
@Module({ imports: [DatabaseModule, AuditModule, AuctionsModule, SettlementCoreModule], controllers: [ReceiptsController],
  providers: [AuctionScheduler, ReceiptsService], exports: [SettlementCoreModule, AuctionScheduler] })
export class SettlementsModule {}
