import { Body, Controller, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import type { AuthUser } from '@holobid/contracts';

import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { CurrentUser } from '../auth/auth-user';
import { RequireRoles } from '../auth/roles.guard';

import { BidDto } from './bid.dto';
import { BidsService } from './bids.service';

@Controller('auctions/:auctionId/bids')
export class BidsController {
  constructor(private readonly bids: BidsService) {}

  @Post()
  @RequireRoles('BIDDER')
  async place(
    @CurrentUser() user: AuthUser,
    @Param('auctionId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: BidDto,
    @IdempotencyKey(new ParseUUIDPipe({ version: '4' })) key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.bids.place(
      user.id,
      id.toLowerCase(),
      key.toLowerCase(),
      input.amountCents,
    );

    response.status(result.status);

    return result.body;
  }
}
