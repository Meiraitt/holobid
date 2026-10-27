import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { AuditModule } from '../audit/audit.module';

import { AuctionScheduler } from './auction-scheduler';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { SettlementCoreModule } from './settlement-core.module';

@Module({
  imports: [DatabaseModule, AuditModule, AuctionsModule, SettlementCoreModule],
  controllers: [ReceiptsController],
  providers: [AuctionScheduler, ReceiptsService],
  exports: [SettlementCoreModule, AuctionScheduler],
})
export class SettlementsModule {}
