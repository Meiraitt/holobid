import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { WalletPersistenceModule } from './wallet-persistence.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { DepositRateLimiter } from './deposit-rate-limiter';

@Module({
  imports: [WalletPersistenceModule, AuthModule, IdempotencyModule],
  controllers: [WalletsController],
  providers: [WalletsService, DepositRateLimiter],
  exports: [WalletPersistenceModule],
})
export class WalletsModule {}
