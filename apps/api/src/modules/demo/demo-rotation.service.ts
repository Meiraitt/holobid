import { Injectable, Logger, OnApplicationBootstrap, BeforeApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '../../config/environment';
import { AuctionEvents } from '../auctions/auction-events';
import { AuctionClock } from '../auctions/auction-clock';
import { DemoService } from './demo.service';
@Injectable()
export class DemoRotation implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private active = false;
  private ready = false;
  private again = false;
  private failures = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private unsubscribe?: () => void;
  private readonly logger = new Logger(DemoRotation.name);
  constructor(private readonly config: ConfigService<ApiEnvironment, true>, private readonly demo: DemoService, private readonly events: AuctionEvents, private readonly clock: AuctionClock) {}
  async onApplicationBootstrap() {
    if (this.config.get('DEMO_MODE', { infer: true }) && this.config.get('NODE_ENV', { infer: true }) !== 'test') await this.start();
  }
  async start() {
    if (this.active || !this.config.get('DEMO_MODE', { infer: true })) return;
    this.active = true;
    this.unsubscribe = this.events.subscribe(event => { if (['ENDED', 'CANCELLED', 'AUDIT_CONFIRMED'].includes(event.reason)) void this.refresh(); });
    await this.refresh();
  }
  private later(delay: number) {
    clearTimeout(this.timer); if (!this.active) return;
    this.timer = setTimeout(() => { void this.refresh(); }, Math.max(1, Math.min(2_147_483_647, delay))); this.timer.unref();
  }
  refresh(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      try {
        const result = await (this.ready ? this.demo.rotate() : this.demo.seed()); this.ready = true; this.failures = 0;
        this.later(result.nextAt.getTime() - this.clock.now().getTime());
      } catch {
        this.logger.error({ event: 'demo.rotation_unavailable' });
        this.later([1000, 5000, 30_000][this.failures++] ?? 15 * 60_000);
      }
    })().finally(() => { this.running = undefined; if (this.again && this.active) { this.again = false; void this.refresh(); } });
    return this.running;
  }
  async beforeApplicationShutdown() { this.active = false; this.unsubscribe?.(); clearTimeout(this.timer); await this.running; }
}
