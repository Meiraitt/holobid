import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';
import { AuctionPublicationService } from './auction-publication.service';
import { AuctionCursorService } from './auction-cursor.service';
import { AuctionClock } from './auction-clock';
import { AuctionPublishLimiter } from './auction-publish-limiter';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuctionsRepository } from './auctions.repository';
import { AuctionOwnershipService } from './auction-ownership.service';

@Module({ imports: [DatabaseModule, AuthModule, AuditModule, CatalogModule, IdempotencyModule], controllers: [AuctionsController],
  providers: [AuctionsRepository, AuctionOwnershipService, AuctionsService, AuctionPublicationService, AuctionCursorService, AuctionClock, AuctionPublishLimiter],
  exports: [AuctionsRepository, AuctionOwnershipService] })
export class AuctionsModule {}
