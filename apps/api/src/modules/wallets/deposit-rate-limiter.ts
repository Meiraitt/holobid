import { Injectable } from '@nestjs/common';

import { FixedWindowLimiter } from '../../common/http/fixed-window-limiter';

@Injectable()
export class DepositRateLimiter extends FixedWindowLimiter {
  constructor() {
    super(5);
  }
}
