import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import type { AuthUser } from '@holobid/contracts';

import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { CurrentUser } from '../auth/auth-user';
import { EmptyBodyPipe } from '../auth/empty-body.pipe';
import { RequireRoles } from '../auth/roles.guard';

import { AuctionQueryDto, CreateAuctionDto } from './auction.dto';
import { AuctionPublicationService } from './auction-publication.service';
import { AuctionsService } from './auctions.service';

@Controller('auctions')
export class AuctionsController {
  constructor(
    private readonly auctions: AuctionsService,
    private readonly publication: AuctionPublicationService,
  ) {}

  @Get()
  list(@Query() query: AuctionQueryDto) {
    return this.auctions.list(query);
  }

  @Get(':auctionId')
  detail(@Param('auctionId', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.auctions.detail(id.toLowerCase());
  }

  @Post()
  @RequireRoles('AUCTIONEER')
  async create(
    @CurrentUser() user: AuthUser,
    @Body() input: CreateAuctionDto,
    @IdempotencyKey(new ParseUUIDPipe({ version: '4' })) key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.publication.create(user.id, key.toLowerCase(), input);

    response.status(result.status);

    return result.body;
  }

  @Post(':auctionId/cancel')
  @RequireRoles('AUCTIONEER')
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('auctionId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(EmptyBodyPipe) _input: Record<string, never>,
    @IdempotencyKey(new ParseUUIDPipe({ version: '4' })) key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auctions.cancel(user.id, id.toLowerCase(), key.toLowerCase());

    response.status(result.status);

    return result.body;
  }
}
