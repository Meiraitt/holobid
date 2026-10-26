import process from 'node:process';
import { createHash, randomUUID } from 'node:crypto';
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Response as TestResponse } from 'supertest';
import type { AuthUser } from '@holobid/contracts';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DatabaseService } from '../../src/database/database.service';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { AuthRateLimiter } from '../../src/modules/auth/auth-rate-limiter';
import { AccessTokenService } from '../../src/modules/auth/access-token.service';
import { SessionRevocationEvents } from '../../src/modules/auth/session-revocation.events';
import { SessionsService } from '../../src/modules/auth/sessions.service';
import { RequireRoles } from '../../src/modules/auth/roles.guard';
import { CurrentUser } from '../../src/modules/auth/auth-user';
import { AuctionsModule } from '../../src/modules/auctions/auctions.module';
import { AuctionOwnershipService } from '../../src/modules/auctions/auction-ownership.service';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') throw new Error('Run npm run test:db.');
const password = 'Session password 42!';
const origin = 'http://localhost:5173';

// Authorization fixtures are never registered in the executable API.
@Controller('_authorization')
class AuthorizationController {
  constructor(private readonly ownership: AuctionOwnershipService) {}

  @Get('bidder')
  @RequireRoles('BIDDER')
  bidder() { return { allowed: true }; }

  @Get('auctioneer')
  @RequireRoles('AUCTIONEER')
  auctioneer() { return { allowed: true }; }

  @Get('owned/:id')
  @RequireRoles('AUCTIONEER')
  async owned(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const auction = await this.ownership.requireOwned(id, user.id);
    return { id: auction.id };
  }
}

function cookieOf(response: TestResponse): string {
  const cookies = response.headers['set-cookie'] as unknown as string[];
  return cookies[0]!.split(';')[0]!;
}
function tokenOf(cookie: string): string { return cookie.split('=')[1]!; }
function digest(token: string): string { return createHash('sha256').update(token).digest('hex'); }

describe('Session lifecycle and authorization', () => {
  let app: NestExpressApplication;
  let db: DatabaseService;

  async function createApp(production = false) {
    const builder = Test.createTestingModule({ imports: [AppModule, AuthModule, AuctionsModule], controllers: [AuthorizationController] });
    if (production) builder.overrideProvider(ConfigService).useValue(new ConfigService({
      NODE_ENV: 'production', WEB_ORIGIN: 'https://holobid.example', PORT: 3000,
      DATABASE_URL: process.env.DATABASE_URL, AUDIT_DATABASE_URL: process.env.AUDIT_DATABASE_URL, JWT_SECRET: process.env.JWT_SECRET,
    }));
    const module = await builder.compile();
    const instance = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(instance);
    await instance.init();
    return instance;
  }
  beforeAll(async () => { app = await createApp(); db = app.get(DatabaseService); });
  beforeEach(() => { jest.spyOn(app.get(AuthRateLimiter), 'consume').mockReturnValue(null); });
  afterAll(async () => { await app.close(); });

  function post(path: string, body: object = {}) {
    return request(app.getHttpServer()).post(`/api/v1/auth/${path}`)
      .set('Origin', origin).set('X-CSRF-Protection', '1').send(body);
  }
  function me(token: string) {
    return request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
  }
  function claims(result: TestResponse) { return app.get(JwtService).decode(result.body.accessToken); }
  async function register(role: 'BIDDER' | 'AUCTIONEER' = 'BIDDER') {
    const email = `${randomUUID()}@example.test`;
    const result = await post('register', { email, password }).expect(201);
    if (role === 'BIDDER') return result;
    await db.client.user.update({ where: { email }, data: { role } });
    return post('login', { email, password }).expect(200);
  }

  it('stores only a refresh hash and binds JWTs to a persistent session', async () => {
    const result = await register();
    const cookie = cookieOf(result);
    const token = tokenOf(cookie);
    const session = await db.client.authSession.findUniqueOrThrow({ where: { id: claims(result).sid } });
    expect(session.userId).toBe(result.body.user.id);
    expect(session.refreshTokenHash).toBe(digest(token));
    expect(session.refreshTokenHash).not.toBe(token);
    expect(session.rotationVersion).toBe(0);
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBeGreaterThan(604_790_000);
    const header = (result.headers['set-cookie'] as unknown as string[])[0]!;
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/api/v1/auth');
    expect(header).not.toMatch(/Domain=|Secure/);
    expect(JSON.stringify(result.body)).not.toContain(token);
    expect(Object.keys(result.body).sort()).toEqual(['accessToken', 'expiresIn', 'user']);
  });

  it('sets Secure cookies in production with no Domain attribute', async () => {
    const production = await createApp(true);
    try {
      const result = await request(production.getHttpServer()).post('/api/v1/auth/register')
        .set('Origin', 'https://holobid.example').set('X-CSRF-Protection', '1')
        .send({ email: `${randomUUID()}@example.test`, password }).expect(201);
      const header = (result.headers['set-cookie'] as unknown as string[])[0]!;
      expect(header).toContain('Secure');
      expect(header).not.toContain('Domain=');
    } finally { await production.close(); }
  });

  it.each(['register', 'login', 'refresh', 'logout'])('requires origin, JSON and CSRF header on %s', async (path) => {
    const body = path === 'register' || path === 'login' ? { email: `${randomUUID()}@example.test`, password } : {};
    await post(path, body).unset('Origin').expect(403);
    await post(path, body).set('Origin', 'null').expect(403);
    await post(path, body).set('Origin', 'https://evil.example').expect(403);
    await post(path, body).unset('X-CSRF-Protection').expect(403);
    await request(app.getHttpServer()).post(`/api/v1/auth/${path}`).set('Origin', origin)
      .set('X-CSRF-Protection', '1').type('form').send({}).expect(403);
  });

  it('rotates once and rejects a replay without revoking the current session', async () => {
    const result = await register();
    const oldCookie = cookieOf(result);
    const updated = await post('refresh').set('Cookie', oldCookie).expect(200);
    expect(cookieOf(updated)).not.toBe(oldCookie);
    expect(claims(updated).sid).toBe(claims(result).sid);
    const rejected = await post('refresh').set('Cookie', oldCookie).expect(401);
    expect(rejected.body.code).toBe('INVALID_REFRESH_TOKEN');
    expect(rejected.headers['set-cookie']).toBeUndefined();
    await post('refresh').set('Cookie', cookieOf(updated)).expect(200);
    await me(result.body.accessToken).expect(200);
  });

  it('has a single winner for concurrent refresh and never clears its cookie', async () => {
    const result = await register();
    const cookie = cookieOf(result);
    const responses = await Promise.all([post('refresh').set('Cookie', cookie), post('refresh').set('Cookie', cookie)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 401]);
    const winner = responses.find(r => r.status === 200)!;
    expect(responses.find(r => r.status === 401)!.headers['set-cookie']).toBeUndefined();
    const session = await db.client.authSession.findUniqueOrThrow({ where: { id: claims(result).sid } });
    expect(session.rotationVersion).toBe(1);
    expect(session.revokedAt).toBeNull();
    expect(session.refreshTokenHash).toBe(digest(tokenOf(cookieOf(winner))));
    await me(winner.body.accessToken).expect(200);
  });

  it('keeps the old refresh usable when signing fails before transaction commit', async () => {
    const result = await register();
    jest.spyOn(app.get(AccessTokenService), 'sign').mockRejectedValueOnce(new Error('simulated signing failure'));
    const response = await post('refresh').set('Cookie', cookieOf(result)).expect(500);
    expect(response.headers['set-cookie']).toBeUndefined();
    await post('refresh').set('Cookie', cookieOf(result)).expect(200);
  });

  it('rejects missing, malformed, duplicated and unexpected refresh input', async () => {
    await post('refresh').expect(401);
    await post('refresh').set('Cookie', 'holobid_refresh=%invalid').expect(401);
    await post('refresh').set('Cookie', 'holobid_refresh=invalid').expect(401);
    const result = await register();
    await post('refresh').set('Cookie', `${cookieOf(result)}; ${cookieOf(result)}`).expect(401);
    await post('refresh', { token: tokenOf(cookieOf(result)) }).set('Cookie', cookieOf(result)).expect(400);
    await post('logout', { userId: result.body.user.id }).set('Cookie', cookieOf(result)).expect(400);
    await me(result.body.accessToken).expect(200);
  });

  it('revokes a session immediately, clears the cookie and publishes a single notification after commit', async () => {
    const result = await register();
    const event = jest.fn();
    const unsubscribe = app.get(SessionRevocationEvents).onRevoked(event);
    try {
      const loggedOut = await post('logout').set('Cookie', cookieOf(result)).expect(204);
      expect((loggedOut.headers['set-cookie'] as unknown as string[])[0]).toMatch(/holobid_refresh=;.*Expires=Thu, 01 Jan 1970/);
      expect(event).toHaveBeenCalledTimes(1);
      expect(event).toHaveBeenCalledWith(claims(result).sid);
      const session = await db.client.authSession.findUniqueOrThrow({ where: { id: claims(result).sid } });
      expect(session.revokedAt).not.toBeNull();
      await me(result.body.accessToken).expect(401);
      await post('refresh').set('Cookie', cookieOf(result)).expect(401);
      await post('logout').set('Cookie', cookieOf(result)).expect(204);
      await post('logout').expect(204);
      expect(event).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); }
  });

  it('keeps a second login session active after the first one logs out', async () => {
    const first = await register();
    const second = await post('login', { email: first.body.user.email, password }).expect(200);
    await post('logout').set('Cookie', cookieOf(first)).expect(204);
    await me(first.body.accessToken).expect(401);
    await me(second.body.accessToken).expect(200);
  });

  it('revokes the session even when logout races with refresh using the current bearer token', async () => {
    const result = await register();
    const [refresh, logout] = await Promise.all([
      post('refresh').set('Cookie', cookieOf(result)),
      post('logout').set('Cookie', cookieOf(result)).set('Authorization', `Bearer ${result.body.accessToken}`),
    ]);
    expect(logout.status).toBe(204);
    expect([200, 401]).toContain(refresh.status);
    await me(result.body.accessToken).expect(401);
    if (refresh.status === 200) {
      await me(refresh.body.accessToken).expect(401);
      await post('refresh').set('Cookie', cookieOf(refresh)).expect(401);
    }
  });

  it('denies expired sessions even while the access JWT is valid', async () => {
    const result = await register();
    await db.client.authSession.update({ where: { id: claims(result).sid }, data: {
      createdAt: new Date(Date.now() - 8 * 86_400_000), expiresAt: new Date(Date.now() - 1000),
    } });
    await me(result.body.accessToken).expect(401);
    const response = await post('refresh').set('Cookie', cookieOf(result)).expect(401);
    expect(response.body.code).toBe('SESSION_EXPIRED');
  });

  it('cannot authenticate a JWT whose subject belongs to another session', async () => {
    const first = await register();
    const second = await register();
    const forged = await app.get(AccessTokenService).sign(second.body.user, claims(first).sid);
    await me(forged).expect(401);
  });

  it('checks current database roles instead of trusting an old role claim', async () => {
    const bidder = await register();
    const auctioneer = await register('AUCTIONEER');
    const get = (path: string, token: string) => request(app.getHttpServer()).get(`/api/v1/_authorization/${path}`)
      .set('Authorization', `Bearer ${token}`);
    await request(app.getHttpServer()).get('/api/v1/_authorization/bidder').expect(401);
    await get('bidder', bidder.body.accessToken).expect(200);
    await get('auctioneer', bidder.body.accessToken).expect(403);
    await get('auctioneer', auctioneer.body.accessToken).expect(200);
    await get('bidder', auctioneer.body.accessToken).expect(403);
    await db.client.user.update({ where: { id: auctioneer.body.user.id }, data: { role: 'BIDDER' } });
    await get('auctioneer', auctioneer.body.accessToken).expect(403);
    await get('bidder', auctioneer.body.accessToken).expect(200);
  });

  it("returns the same 404 for another auctioneer's auction and a missing auction", async () => {
    const owner = await register('AUCTIONEER');
    const other = await register('AUCTIONEER');
    const snapshot = await db.client.catalogSnapshot.create({ data: { externalId: 'swsh3-136', language: 'en', title: 'Pikachu', setId: 'swsh3', setName: 'Test set', cardNumber: '136', fetchedAt: new Date() } });
    const bytes = Buffer.from(randomUUID());
    const image = await db.client.mediaAsset.create({ data: { bytes, mimeType: 'image/png', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } });
    const end = new Date(Date.now() + 600_000);
    const auction = await db.client.auction.create({ data: { sellerId: owner.body.user.id, snapshotId: snapshot.id, imageId: image.id, startsAt: new Date(), originalEndsAt: end, endsAt: end, startingPriceCents: 100n, minimumIncrementCents: 10n, auditHead: 'a'.repeat(64), auditMac: 'b'.repeat(64) } });
    await request(app.getHttpServer()).get(`/api/v1/_authorization/owned/${auction.id}`)
      .set('Authorization', `Bearer ${owner.body.accessToken}`).expect(200, { id: auction.id });
    for (const id of [auction.id, randomUUID()]) {
      const response = await request(app.getHttpServer()).get(`/api/v1/_authorization/owned/${id}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`).expect(404);
      expect(response.body.code).toBe('AUCTION_NOT_FOUND');
    }
  });

  it('provides the expiration deadline and a revocation subscription for future sockets', async () => {
    const result = await register();
    const identity = await app.get(SessionsService).authenticate(result.body.accessToken);
    expect(identity.expiresAt.getTime()).toBe(claims(result).exp * 1000);
    const unsubscribe = app.get(SessionRevocationEvents).onRevoked(() => { throw new Error('listener failed'); });
    try { await post('logout').set('Cookie', cookieOf(result)).expect(204); }
    finally { unsubscribe(); }
    await me(result.body.accessToken).expect(401);
  });

  it('retains sessions and refresh ability after the API application restarts', async () => {
    const result = await register();
    await app.close();
    app = await createApp();
    db = app.get(DatabaseService);
    await me(result.body.accessToken).expect(200);
    await post('refresh').set('Cookie', cookieOf(result)).expect(200);
  });
});
