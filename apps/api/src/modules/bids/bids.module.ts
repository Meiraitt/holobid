import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { WalletPersistenceModule } from '../wallets/wallet-persistence.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { BidsController } from './bids.controller';
import { BidsService } from './bids.service';
import { BidsRepository } from './bids.repository';
import { BidRateLimiter } from './bid-rate-limiter';
@Module({ imports: [AuthModule, AuditModule, AuctionsModule, WalletPersistenceModule, IdempotencyModule],
  controllers: [BidsController], providers: [BidsService, BidsRepository, BidRateLimiter], exports: [BidsRepository] })
export class BidsModule {}
