import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SignedCursorService } from '../../common/pagination/signed-cursor.service';
import { AuditModule } from '../audit/audit.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
@Module({ imports: [DatabaseModule, AuditModule, AuctionsModule], controllers: [HistoryController], providers: [HistoryService, SignedCursorService] })
export class HistoryModule {}
