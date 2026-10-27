import { Injectable } from '@nestjs/common';

@Injectable()
export class AuctionClock {
  now(): Date {
    return new Date();
  }
}
