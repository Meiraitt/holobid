import { Body, Controller, Get, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import type { AuthUser } from '@holobid/contracts';

import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { CurrentUser } from '../auth/auth-user';
import { RequireRoles } from '../auth/roles.guard';

import { DepositDto } from './deposit.dto';
import { WalletsService } from './wallets.service';

@Controller('wallet')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get()
  @RequireRoles('BIDDER', 'AUCTIONEER')
  get(@CurrentUser() user: AuthUser) {
    return this.wallets.get(user.id);
  }

  @Post('deposits')
  @RequireRoles('BIDDER')
  async deposit(
    @CurrentUser() user: AuthUser,
    @Body() input: DepositDto,
    @IdempotencyKey(new ParseUUIDPipe({ version: '4' })) key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.wallets.deposit(user.id, key.toLowerCase(), input.amountCents);

    response.status(result.status);

    return result.body;
  }
}
