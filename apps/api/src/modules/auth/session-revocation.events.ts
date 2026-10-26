import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SessionRevocationEvents {
  private readonly listeners = new Set<(sessionId: string) => void>();
  private readonly logger = new Logger(SessionRevocationEvents.name);

  // BE-14 subscribes here to disconnect sockets, and unsubscribes on shutdown.
  onRevoked(listener: (sessionId: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(sessionId: string): void {
    for (const listener of this.listeners) {
      try { listener(sessionId); }
      catch { this.logger.error({ event: 'auth.revocation_listener_failed' }); }
    }
  }
}
