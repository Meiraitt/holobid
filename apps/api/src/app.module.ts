import { HistoryModule } from './modules/history/history.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import process from 'node:process';
import { BidsModule } from './modules/bids/bids.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment';
import { AuctionsModule } from './modules/auctions/auctions.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnvironment,
    }),
    HealthModule,
    HistoryModule,
    AuthModule,
    AuditModule,
    AuctionsModule,
    BidsModule,
    SettlementsModule,
    WalletsModule,
    CatalogModule,
  ],
})
export class AppModule {}
