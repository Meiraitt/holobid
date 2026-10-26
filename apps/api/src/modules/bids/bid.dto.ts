import { IsInt, Max, Min } from 'class-validator';
import type { BidInput } from '@holobid/contracts';
import { MAX_MONEY_CENTS } from '../../common/money';
export class BidDto implements BidInput {
  @IsInt() @Min(1) @Max(MAX_MONEY_CENTS) amountCents!: number;
}
