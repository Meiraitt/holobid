import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { CatalogController } from './catalog.controller';
import { CatalogHttpService } from './catalog-http.service';
import { TCGdexCatalogAdapter } from './tcgdex-catalog.adapter';
import { CatalogRateLimitGuard } from './catalog-rate-limit.guard';
import { CatalogImportService } from './catalog-import.service';
import { CatalogRepository } from './catalog.repository';

@Module({
  imports: [AuthModule, MediaModule], controllers: [CatalogController],
  providers: [CatalogHttpService, TCGdexCatalogAdapter, CatalogRateLimitGuard, CatalogImportService, CatalogRepository],
  exports: [CatalogImportService],
})
export class CatalogModule {}
