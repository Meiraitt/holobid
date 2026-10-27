import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { WalletPersistenceModule } from '../wallets/wallet-persistence.module';

import { BidRateLimiter } from './bid-rate-limiter';
import { BidsController } from './bids.controller';
import { BidsRepository } from './bids.repository';
import { BidsService } from './bids.service';

@Module({
  imports: [AuthModule, AuditModule, AuctionsModule, WalletPersistenceModule, IdempotencyModule],
  controllers: [BidsController],
  providers: [BidsService, BidsRepository, BidRateLimiter],
  exports: [BidsRepository],
})
export class BidsModule {}
