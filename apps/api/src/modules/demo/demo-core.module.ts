import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { CatalogModule } from '../catalog/catalog.module';
import { WalletPersistenceModule } from '../wallets/wallet-persistence.module';
import { SettlementCoreModule } from '../settlements/settlement-core.module';
import { DemoFixtures } from './demo-fixtures.service';
import { DemoRepository } from './demo.repository';
import { DemoPublicationService } from './demo-publication.service';
import { DemoService } from './demo.service';
@Module({ imports: [DatabaseModule, IdempotencyModule, AuthModule, AuditModule, AuctionsModule, CatalogModule, WalletPersistenceModule, SettlementCoreModule],
  providers: [DemoFixtures, DemoRepository, DemoPublicationService, DemoService], exports: [DemoService] })
export class DemoCoreModule {}
