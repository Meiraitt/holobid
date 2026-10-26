import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '../../config/environment';
import { DatabaseService } from '../../database/database.service';
import { PasswordService } from '../auth/password.service';
import { AuctionClock } from '../auctions/auction-clock';
import { SettlementsService } from '../settlements/settlements.service';
import { DemoRepository } from './demo.repository';
import { DemoPublicationService } from './demo-publication.service';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, demoId, demoWindow } from './demo.constants';
@Injectable()
export class DemoService {
  constructor(private readonly config: ConfigService<ApiEnvironment, true>, private readonly database: DatabaseService,
    private readonly repository: DemoRepository, private readonly passwords: PasswordService, private readonly publication: DemoPublicationService,
    private readonly settlements: SettlementsService, private readonly clock: AuctionClock) {}
  private enabled() { if (!this.config.get('DEMO_MODE', { infer: true })) throw new Error('Demo data requires DEMO_MODE=true.'); }
  async seed() {
    this.enabled(); const now = this.clock.now();
    const hashes = await Promise.all(DEMO_ACCOUNTS.map(() => this.passwords.hash(DEMO_PASSWORD)));
    const seller = await this.database.transaction(tx => this.repository.accounts(hashes, now, tx)), base = seller.createdAt.getTime();
    const ended = await this.publication.publish(demoId('ended'), 'base1-58', new Date(base - 3_600_000), new Date(base - 1_800_000), false);
    if (!ended || await this.settlements.settle(ended.id) !== 'COMPLETED') throw new Error('Demo settlement requires confirmation.');
    const scheduled = await this.publication.publish(demoId('scheduled'), 'base1-4', new Date(base + 3_600_000), new Date(base + 7_200_000), false);
    if (scheduled && this.clock.now() >= scheduled.endsAt) await this.settlements.settle(scheduled.id);
    return this.rotate();
  }
  async rotate(): Promise<{ auctionId: string; nextAt: Date }> {
    this.enabled(); const now = this.clock.now(), window = demoWindow(now), active = await this.repository.open();
    const previous = active ?? await this.repository.latest();
    if (previous && previous.lifecycle !== 'CANCELLED' && previous.endsAt <= now && previous.settlementStatus !== 'COMPLETED') {
      if (await this.settlements.settle(previous.id) !== 'COMPLETED') throw new Error('Previous demo settlement requires confirmation.');
    }
    if (active && active.endsAt > now) return { auctionId: active.id, nextAt: active.endsAt };
    const lot = await this.publication.publish(window.id, 'base1-58', window.startsAt, window.endsAt, true);
    if (!lot) throw new Error('Demo auction unavailable.');
    // Cancellation never creates a second lot in the same UTC daily window.
    return { auctionId: lot.id, nextAt: lot.lifecycle === 'OPEN' ? lot.endsAt : window.endsAt };
  }
}
