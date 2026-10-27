import { IsIn, IsOptional } from 'class-validator';

import type { AuctionStatus } from '@holobid/contracts';

import { PageQueryDto } from '../../common/pagination/page-query.dto';

export class ParticipationQueryDto extends PageQueryDto {
  @IsIn(['all', 'active', 'won']) filter: 'all' | 'active' | 'won' = 'all';
}
export class OwnedAuctionQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED']) status?: AuctionStatus;
}
