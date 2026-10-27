import { Module } from '@nestjs/common';

import { SignedCursorService } from '../../common/pagination/signed-cursor.service';
import { DatabaseModule } from '../../database/database.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { AuditModule } from '../audit/audit.module';

import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [DatabaseModule, AuditModule, AuctionsModule],
  controllers: [HistoryController],
  providers: [HistoryService, SignedCursorService],
})
export class HistoryModule {}
