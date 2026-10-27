import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';

import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogHttpService } from './catalog-http.service';
import { CatalogImportService } from './catalog-import.service';
import { CatalogRateLimitGuard } from './catalog-rate-limit.guard';
import { TCGdexCatalogAdapter } from './tcgdex-catalog.adapter';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [CatalogController],
  providers: [
    CatalogHttpService,
    TCGdexCatalogAdapter,
    CatalogRateLimitGuard,
    CatalogImportService,
    CatalogRepository,
  ],
  exports: [CatalogImportService],
})
export class CatalogModule {}
