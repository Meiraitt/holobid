import { WalletEvents } from './wallet-events';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { WalletsRepository } from './wallets.repository';

@Module({
  imports: [DatabaseModule],
  providers: [WalletsRepository, WalletEvents],
  exports: [WalletsRepository, WalletEvents],
})
export class WalletPersistenceModule {}
