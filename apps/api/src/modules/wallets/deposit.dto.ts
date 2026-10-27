import { IsInt, Max, Min } from 'class-validator';

import type { DepositInput } from '@holobid/contracts';

import { MAX_MONEY_CENTS } from '../../common/money';

export class DepositDto implements DepositInput {
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_CENTS)
  amountCents!: number;
}
