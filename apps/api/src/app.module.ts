import process from 'node:process';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnvironment } from './config/environment';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AuctionsModule } from './modules/auctions/auctions.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BidsModule } from './modules/bids/bids.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DemoModule } from './modules/demo/demo.module';
import { HealthModule } from './modules/health/health.module';
import { HistoryModule } from './modules/history/history.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { WalletsModule } from './modules/wallets/wallets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnvironment,
    }),
    HealthModule,
    RealtimeModule,
    AccountsModule,
    HistoryModule,
    AuthModule,
    AuditModule,
    AuctionsModule,
    BidsModule,
    SettlementsModule,
    DemoModule,
    WalletsModule,
    CatalogModule,
  ],
})
export class AppModule {}
