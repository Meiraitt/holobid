import { Injectable } from '@nestjs/common';
import { FixedWindowLimiter } from '../../common/http/fixed-window-limiter';

@Injectable()
export class AuctionPublishLimiter extends FixedWindowLimiter { constructor() { super(5); } }
