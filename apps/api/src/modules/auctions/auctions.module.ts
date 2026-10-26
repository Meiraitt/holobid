import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuctionsRepository } from './auctions.repository';
import { AuctionOwnershipService } from './auction-ownership.service';

@Module({ imports: [DatabaseModule], providers: [AuctionsRepository, AuctionOwnershipService],
  exports: [AuctionsRepository, AuctionOwnershipService] })
export class AuctionsModule {}
