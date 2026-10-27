import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';

import { PageQueryDto } from '../../common/pagination/page-query.dto';

import { HistoryService } from './history.service';

@Controller('auctions')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get(':auctionId/bids')
  bids(
    @Param('auctionId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: PageQueryDto,
  ) {
    return this.history.history(id.toLowerCase(), query);
  }

  @Get(':auctionId/audit')
  audit(
    @Param('auctionId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: PageQueryDto,
  ) {
    return this.history.verify(id.toLowerCase(), query);
  }
}
