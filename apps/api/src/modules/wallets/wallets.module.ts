import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { AuthModule } from '../auth/auth.module';

import { DepositRateLimiter } from './deposit-rate-limiter';
import { WalletPersistenceModule } from './wallet-persistence.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [WalletPersistenceModule, AuthModule, IdempotencyModule],
  controllers: [WalletsController],
  providers: [WalletsService, DepositRateLimiter],
  exports: [WalletPersistenceModule],
})
export class WalletsModule {}
