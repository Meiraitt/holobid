import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { AuthModule } from '../auth/auth.module';
import { WalletPersistenceModule } from '../wallets/wallet-persistence.module';

import { RealtimeGateway } from './realtime.gateway';
import { RealtimeRepository } from './realtime.repository';

@Module({
  imports: [DatabaseModule, AuthModule, AuctionsModule, WalletPersistenceModule],
  providers: [RealtimeGateway, RealtimeRepository],
})
export class RealtimeModule {}
