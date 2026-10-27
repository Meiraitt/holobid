import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { DatabaseModule } from '../../database/database.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { SettlementCoreModule } from '../settlements/settlement-core.module';
import { WalletPersistenceModule } from '../wallets/wallet-persistence.module';

import { DemoRepository } from './demo.repository';
import { DemoService } from './demo.service';
import { DemoFixtures } from './demo-fixtures.service';
import { DemoPublicationService } from './demo-publication.service';

@Module({
  imports: [
    DatabaseModule,
    IdempotencyModule,
    AuthModule,
    AuditModule,
    AuctionsModule,
    CatalogModule,
    WalletPersistenceModule,
    SettlementCoreModule,
  ],
  providers: [DemoFixtures, DemoRepository, DemoPublicationService, DemoService],
  exports: [DemoService],
})
export class DemoCoreModule {}
