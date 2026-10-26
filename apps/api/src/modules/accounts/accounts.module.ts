import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SignedCursorService } from '../../common/pagination/signed-cursor.service';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { WalletPersistenceModule } from '../wallets/wallet-persistence.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AccountsRepository } from './accounts.repository';
@Module({ imports: [DatabaseModule, AuthModule, AuditModule, AuctionsModule, WalletPersistenceModule], controllers: [AccountsController],
  providers: [AccountsService, AccountsRepository, SignedCursorService] })
export class AccountsModule {}
