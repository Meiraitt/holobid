import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { WalletsRepository } from './wallets.repository';

@Module({
  imports: [DatabaseModule],
  providers: [WalletsRepository],
  exports: [WalletsRepository],
})
export class WalletPersistenceModule {}
