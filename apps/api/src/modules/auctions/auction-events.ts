import { Injectable, Logger } from '@nestjs/common';
export type AuctionChange = { auctionId: string; reason: 'RECHECK' | 'PUBLISHED' | 'BID_ACCEPTED' | 'CANCELLED' | 'STARTED' | 'ENDED' | 'AUDIT_CONFIRMED'; extended?: boolean };
@Injectable()
export class AuctionEvents {
  private readonly listeners = new Set<(event: AuctionChange) => void>();
  private readonly logger = new Logger(AuctionEvents.name);
  subscribe(listener: (event: AuctionChange) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  publish(event: AuctionChange) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { this.logger.error({ event: 'auction.listener_failed' }); }
    }
  }
}
