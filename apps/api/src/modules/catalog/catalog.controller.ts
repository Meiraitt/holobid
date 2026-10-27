import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { RequireRoles } from '../auth/roles.guard';

import { CatalogIdDto, CatalogQueryDto } from './catalog-query.dto';
import { CatalogRateLimitGuard } from './catalog-rate-limit.guard';
import { TCGdexCatalogAdapter } from './tcgdex-catalog.adapter';

@Controller('catalog/items')
@RequireRoles('AUCTIONEER')
export class CatalogController {
  constructor(private readonly catalog: TCGdexCatalogAdapter) {}

  @Get()
  @UseGuards(CatalogRateLimitGuard)
  search(@Query() query: CatalogQueryDto) {
    return this.catalog.search(query.q ?? '', query.page, query.limit);
  }

  @Get(':externalId')
  @UseGuards(CatalogRateLimitGuard)
  async detail(@Param() params: CatalogIdDto) {
    return (await this.catalog.detail(params.externalId)).item;
  }
}
