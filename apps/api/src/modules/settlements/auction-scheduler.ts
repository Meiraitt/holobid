import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { ApiEnvironment } from '../../config/environment';
import { AuctionClock } from '../auctions/auction-clock';
import { AuctionEvents } from '../auctions/auction-events';
import { AuditService } from '../audit/audit.service';
import { AuditAnchorRepository } from '../audit/audit-anchor.repository';

import { SettlementsRepository } from './settlements.repository';
import { SettlementsService } from './settlements.service';

const RECONCILE_MS = 15 * 60_000;
const RETRIES = [1000, 5000, 30_000];

@Injectable()
export class AuctionScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(AuctionScheduler.name);

  private active = false;

  private unsubscribe?: () => void;

  private interval?: ReturnType<typeof setInterval>;

  private recovery?: ReturnType<typeof setTimeout>;

  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly attempts = new Map<string, number>();

  private readonly started = new Set<string>();

  private readonly running = new Map<string, Promise<void>>();

  private scan?: Promise<void>;

  private recoveryAttempt = 0;

  constructor(
    private readonly config: ConfigService<ApiEnvironment, true>,
    private readonly repository: SettlementsRepository,
    private readonly settlements: SettlementsService,
    private readonly audit: AuditService,
    private readonly anchors: AuditAnchorRepository,
    private readonly clock: AuctionClock,
    private readonly events: AuctionEvents,
  ) {}

  async onApplicationBootstrap() {
    // Test suites start it explicitly, so unrelated fixture auctions never run jobs.
    if (this.config.get('NODE_ENV', { infer: true }) !== 'test') {
      await this.start();
    }
  }

  async start() {
    if (this.active) {
      return;
    }

    this.active = true;
    this.unsubscribe = this.events.subscribe((event) => {
      if (['RECHECK', 'PUBLISHED', 'BID_ACCEPTED', 'CANCELLED'].includes(event.reason)) {
        void this.refresh(event.auctionId);
      }
    });
    this.interval = setInterval(() => {
      this.recoveryAttempt = 0;
      void this.reconcile();
    }, RECONCILE_MS);
    this.interval.unref();
    await this.reconcile();
  }

  async beforeApplicationShutdown() {
    this.active = false;
    this.unsubscribe?.();
    clearInterval(this.interval);
    clearTimeout(this.recovery);
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
    this.attempts.clear();
    this.started.clear();
    await Promise.allSettled([...this.running.values(), ...(this.scan ? [this.scan] : [])]);
  }

  private clear(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }

  private later(id: string, delay: number) {
    if (!this.active) {
      return;
    }

    this.clear(id);

    const timer = setTimeout(
      () => {
        void this.refresh(id);
      },
      Math.min(2_147_483_647, Math.max(1, delay)),
    );

    timer.unref();
    this.timers.set(id, timer);
  }

  private retryDelay(id: string): number | undefined {
    const attempt = this.attempts.get(id) ?? 0;
    const delay = RETRIES[attempt];

    if (delay !== undefined) {
      this.attempts.set(id, attempt + 1);
    }

    return delay;
  }

  refresh(id: string): Promise<void> {
    if (!this.active) {
      return Promise.resolve();
    }

    // A signal received during a running job must re-read state once that job ends.
    const previous = this.running.get(id) ?? Promise.resolve();
    const next = previous
      .then(() => this.refreshOne(id))
      .catch(() => {
        this.logger.error({ event: 'scheduler.auction_unavailable', auctionId: id });

        const delay = this.retryDelay(id);

        if (delay !== undefined) {
          this.later(id, delay);
        }
      })
      .finally(() => {
        if (this.running.get(id) === next) {
          this.running.delete(id);
        }
      });

    this.running.set(id, next);

    return next;
  }

  private async refreshOne(id: string) {
    if (!this.active) {
      return;
    }

    this.clear(id);

    let pending = false;

    try {
      const intent = await this.anchors.pendingForAuction(id);

      if (intent) {
        pending = (await this.audit.reconcile(intent.operationKey)) !== 'CONFIRMED';
        if (!pending) {
          this.events.publish({ auctionId: id, reason: 'AUDIT_CONFIRMED' });
        }
      }
    } catch {
      pending = true;
    }

    const lot = await this.repository.schedule(id);

    if (
      !lot ||
      lot.lifecycle === 'CANCELLED' ||
      lot.settlementStatus === 'COMPLETED' ||
      lot.settlementStatus === 'FAILED'
    ) {
      this.started.delete(id);
      this.attempts.delete(id);

      return;
    }

    const now = this.clock.now();

    if (now >= lot.endsAt) {
      const result = await this.settlements.settle(id);

      if (result === 'PENDING') {
        const delay = this.retryDelay(id);

        if (delay !== undefined) {
          this.later(id, delay);
        }
      } else if (result === 'NOT_DUE') {
        this.later(id, 1);
      } // A racing accepted bid extended the durable end.
      else {
        this.started.delete(id);
        this.attempts.delete(id);
      }

      return;
    }

    if (now >= lot.startsAt && !this.started.has(id)) {
      this.started.add(id);
      this.events.publish({ auctionId: id, reason: 'STARTED' });
    }

    const deadline = now < lot.startsAt ? lot.startsAt : lot.endsAt;
    let delay = deadline.getTime() - now.getTime();

    if (pending) {
      const retry = this.retryDelay(id);

      if (retry !== undefined) {
        delay = Math.min(delay, retry);
      }
    } else {
      this.attempts.delete(id);
    }

    this.later(id, delay);
  }

  reconcile(): Promise<void> {
    if (!this.active) {
      return Promise.resolve();
    }

    if (this.scan) {
      return this.scan;
    }

    this.scan = this.scanAll()
      .catch(() => {
        this.logger.error({ event: 'scheduler.recovery_unavailable' });

        const delay = RETRIES[this.recoveryAttempt++];

        if (delay !== undefined && this.active) {
          clearTimeout(this.recovery);
          this.recovery = setTimeout(() => {
            void this.reconcile();
          }, delay);
          this.recovery.unref();
        }
      })
      .finally(() => {
        this.scan = undefined;
      });

    return this.scan;
  }

  private async scanAll() {
    // Pending intents can survive even when an uncertain main commit is absent.
    let after: string | undefined;

    while (this.active) {
      const page = await this.anchors.pendingPage(after);

      if (!page.length) {
        break;
      }

      for (const intent of page) {
        if (!this.active) {
          return;
        }

        if ((await this.audit.reconcile(intent.operationKey)) === 'CONFIRMED') {
          this.events.publish({ auctionId: intent.auctionId, reason: 'AUDIT_CONFIRMED' });
        }
      }

      after = page.at(-1)!.id;
    }

    after = undefined;
    while (this.active) {
      const page = await this.repository.pendingPage(after);

      if (!page.length) {
        break;
      }

      for (const lot of page) {
        if (!this.active) {
          return;
        }

        await this.refresh(lot.id);
      }

      after = page.at(-1)!.id;
    }

    this.recoveryAttempt = 0;
  }
}
