import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { CreateAuctionInput } from '@holobid/contracts';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DatabaseService } from '../../src/database/database.service';
import { AuditDatabaseService } from '../../src/database/audit-database.service';
import { AuthRateLimiter } from '../../src/modules/auth/auth-rate-limiter';
import { AuctionPublishLimiter } from '../../src/modules/auctions/auction-publish-limiter';
import { BidRateLimiter } from '../../src/modules/bids/bid-rate-limiter';
import { AuctionClock } from '../../src/modules/auctions/auction-clock';
import { CatalogHttpService } from '../../src/modules/catalog/catalog-http.service';

export type Account = { id: string; token: string };
export class AuctionHarness {
  app!: NestExpressApplication;
  db!: DatabaseService;
  auditDb!: AuditDatabaseService;
  now = new Date();
  seller!: Account;
  source = { get: jest.fn(async (_url: string, kind: string) => kind === 'image'
    ? { bytes: readFileSync(join(__dirname, '../fixtures/tcgdex/base1-58.webp')), mimeType: 'image/webp' }
    : { bytes: readFileSync(join(__dirname, '../fixtures/tcgdex/base1-58.json')), mimeType: 'application/json' }) };
  async boot() {
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CatalogHttpService).useValue(this.source).compile();
    this.app = module.createNestApplication<NestExpressApplication>({ logger: false }); configureApp(this.app);
    await this.app.init(); await this.app.listen(0, '127.0.0.1');
    this.db = this.app.get(DatabaseService); this.auditDb = this.app.get(AuditDatabaseService);
    for (const type of [AuthRateLimiter, AuctionPublishLimiter, BidRateLimiter]) jest.spyOn(this.app.get(type), 'consume').mockReturnValue(null);
    jest.spyOn(this.app.get(AuctionClock), 'now').mockImplementation(() => new Date(this.now));
  }
  async start() { await this.boot(); this.seller = await this.account('AUCTIONEER'); }
  async close() { await this.app.close(); }
  async account(role: 'BIDDER' | 'AUCTIONEER' = 'BIDDER', balance = 0): Promise<Account> {
    const result = await request(this.app.getHttpServer()).post('/api/v1/auth/register').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1')
      .send({ email: `${randomUUID()}@example.test`, password: 'Auction password 42!' }).expect(201);
    const account = { id: result.body.user.id as string, token: result.body.accessToken as string };
    if (balance) await this.deposit(account, balance).expect(201);
    if (role === 'AUCTIONEER') await this.db.client.user.update({ where: { id: account.id }, data: { role } });
    return account;
  }
  deposit(user: Account, amountCents: number) {
    return request(this.app.getHttpServer()).post('/api/v1/wallet/deposits').set('Authorization', `Bearer ${user.token}`).set('Idempotency-Key', randomUUID()).send({ amountCents });
  }
  async publish(overrides: Partial<CreateAuctionInput> = {}) {
    const result = await request(this.app.getHttpServer()).post('/api/v1/auctions').set('Authorization', `Bearer ${this.seller.token}`).set('Idempotency-Key', randomUUID())
      .send({ externalItemId: 'base1-58', startingPriceCents: 1000, minimumIncrementCents: 100,
        startsAt: new Date(this.now.getTime() - 1000).toISOString(), endsAt: new Date(this.now.getTime() + 600_000).toISOString(), ...overrides }).expect(201);
    return result.body;
  }
  bid(id: string, user: Account, amountCents: unknown = 1000, key: string = randomUUID()) {
    return request(this.app.getHttpServer()).post(`/api/v1/auctions/${id}/bids`).set('Authorization', `Bearer ${user.token}`).set('Idempotency-Key', key).send({ amountCents });
  }
  cancel(id: string) {
    return request(this.app.getHttpServer()).post(`/api/v1/auctions/${id}/cancel`).set('Authorization', `Bearer ${this.seller.token}`).set('Idempotency-Key', randomUUID()).send({});
  }
  async wallet(user: Account) { return (await request(this.app.getHttpServer()).get('/api/v1/wallet').set('Authorization', `Bearer ${user.token}`).expect(200)).body; }
  detail(id: string) { return request(this.app.getHttpServer()).get(`/api/v1/auctions/${id}`); }
}
