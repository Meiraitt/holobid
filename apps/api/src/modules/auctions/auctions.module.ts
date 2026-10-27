import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';

import { AuctionClock } from './auction-clock';
import { AuctionCursorService } from './auction-cursor.service';
import { AuctionEvents } from './auction-events';
import { AuctionOwnershipService } from './auction-ownership.service';
import { AuctionPublicationService } from './auction-publication.service';
import { AuctionPublishLimiter } from './auction-publish-limiter';
import { AuctionsController } from './auctions.controller';
import { AuctionsRepository } from './auctions.repository';
import { AuctionsService } from './auctions.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, CatalogModule, IdempotencyModule],
  controllers: [AuctionsController],
  providers: [
    AuctionEvents,
    AuctionsRepository,
    AuctionOwnershipService,
    AuctionsService,
    AuctionPublicationService,
    AuctionCursorService,
    AuctionClock,
    AuctionPublishLimiter,
  ],
  exports: [AuctionsRepository, AuctionOwnershipService, AuctionClock, AuctionEvents],
})
export class AuctionsModule {}
