import { Injectable } from '@nestjs/common';
import { FixedWindowLimiter } from '../../common/http/fixed-window-limiter';
@Injectable()
export class BidRateLimiter extends FixedWindowLimiter {
  constructor() { super(10, 10_000); }
}
