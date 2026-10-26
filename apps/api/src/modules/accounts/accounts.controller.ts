import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { AuthUser } from '@holobid/contracts';
import { CurrentUser } from '../auth/auth-user';
import { RequireRoles } from '../auth/roles.guard';
import { EmptyBodyPipe } from '../auth/empty-body.pipe';
import { ParticipationQueryDto, OwnedAuctionQueryDto } from './account.dto';
import { AccountsService } from './accounts.service';
@Controller()
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}
  @Get('auctions/:auctionId/me') @RequireRoles('BIDDER')
  mine(@CurrentUser() user: AuthUser, @Param('auctionId', new ParseUUIDPipe({ version: '4' })) id: string, @Query(EmptyBodyPipe) _query: Record<string, never>) {
    void _query; return this.accounts.myAuction(user.id, id.toLowerCase());
  }
  @Get('me/participations') @RequireRoles('BIDDER')
  participations(@CurrentUser() user: AuthUser, @Query() query: ParticipationQueryDto) { return this.accounts.participations(user.id, query); }
  @Get('auctioneer/auctions') @RequireRoles('AUCTIONEER')
  owned(@CurrentUser() user: AuthUser, @Query() query: OwnedAuctionQueryDto) { return this.accounts.owned(user.id, query); }
  @Get('auctioneer/summary') @RequireRoles('AUCTIONEER')
  summary(@CurrentUser() user: AuthUser, @Query(EmptyBodyPipe) _query: Record<string, never>) { void _query; return this.accounts.summary(user.id); }
}
