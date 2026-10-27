import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WalletEvents {
  private readonly listeners = new Set<(userId: string) => void>();

  private readonly logger = new Logger(WalletEvents.name);

  subscribe(listener: (userId: string) => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(userId: string) {
    for (const listener of this.listeners) {
      try {
        listener(userId);
      } catch {
        this.logger.error({ event: 'wallet.listener_failed' });
      }
    }
  }
}
