import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { CreateAuctionInput } from '@holobid/contracts';

import { MAX_MONEY_CENTS } from '../../common/money';
import { EXTERNAL_ID } from '../catalog/catalog-mapper';

const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export class CreateAuctionDto implements CreateAuctionInput {
  @IsString() @Matches(EXTERNAL_ID) externalItemId!: string;

  @IsInt() @Min(1) @Max(MAX_MONEY_CENTS) startingPriceCents!: number;

  @IsInt() @Min(1) @Max(MAX_MONEY_CENTS) minimumIncrementCents!: number;

  @IsISO8601({ strict: true, strictSeparator: true }) @Matches(TIMESTAMP) startsAt!: string;

  @IsISO8601({ strict: true, strictSeparator: true }) @Matches(TIMESTAMP) endsAt!: string;
}
export class AuctionQueryDto {
  @IsOptional() @IsIn(['SCHEDULED', 'LIVE', 'ENDED']) status?: 'SCHEDULED' | 'LIVE' | 'ENDED';

  @IsOptional() @IsString() @MaxLength(512) cursor?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
