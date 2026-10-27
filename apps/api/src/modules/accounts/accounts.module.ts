import { Module } from '@nestjs/common';

import { SignedCursorService } from '../../common/pagination/signed-cursor.service';
import { DatabaseModule } from '../../database/database.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { WalletPersistenceModule } from '../wallets/wallet-persistence.module';

import { AccountsController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, AuctionsModule, WalletPersistenceModule],
  controllers: [AccountsController],
  providers: [AccountsService, AccountsRepository, SignedCursorService],
})
export class AccountsModule {}
