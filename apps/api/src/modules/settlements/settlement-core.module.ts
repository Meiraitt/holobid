import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { BidsModule } from '../bids/bids.module';
import { WalletPersistenceModule } from '../wallets/wallet-persistence.module';
import { SettlementsRepository } from './settlements.repository';
import { SettlementsService } from './settlements.service';
@Module({ imports: [DatabaseModule, AuditModule, AuctionsModule, BidsModule, WalletPersistenceModule],
  providers: [SettlementsRepository, SettlementsService], exports: [SettlementsRepository, SettlementsService] })
export class SettlementCoreModule {}
