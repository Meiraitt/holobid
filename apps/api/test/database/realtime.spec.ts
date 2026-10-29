import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { JwtService } from '@nestjs/jwt';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';

import type { SubscriptionAck } from '@holobid/contracts';

import { AuctionEvents } from '../../src/modules/auctions/auction-events';
import { SessionsService } from '../../src/modules/auth/sessions.service';
import { RealtimeRepository } from '../../src/modules/realtime/realtime.repository';
import { SettlementsService } from '../../src/modules/settlements/settlements.service';
import { WalletsRepository } from '../../src/modules/wallets/wallets.repository';
import { Account, AuctionHarness } from '../helpers/auction-harness';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') {
  throw new Error('Run npm run test:db.');
}

describe('Real Socket.IO clients against the HTTP API', () => {
  let h: AuctionHarness;
  let a: Account;
  let b: Account;
  const clients: Socket[] = [];

  beforeEach(async () => {
    h = new AuctionHarness();
    await h.start();
    a = await h.account('BIDDER', 10_000);
    b = await h.account('BIDDER', 10_000);
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }

    await h.close();
  });

  function event<T = Record<string, unknown>>(
    client: Socket,
    name: string,
    timeout = 2500,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const listener = (value: T) => {
        clearTimeout(timer);
        resolve(value);
      };

      const timer = setTimeout(() => {
        client.off(name, listener);
        reject(new Error(`Missing ${name}`));
      }, timeout);

      client.once(name, listener);
    });
  }

  async function createClient(options: Record<string, unknown> = {}) {
    const client = io(await h.app.getUrl(), {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
      extraHeaders: { Origin: 'http://localhost:5173' },
      auth: {},
      ...options,
    });

    clients.push(client);

    return client;
  }

  async function connect(user?: Account, options: Record<string, unknown> = {}) {
    const client = await createClient({ auth: user ? { token: user.token } : {}, ...options });
    const connected = event(client, 'connect');

    client.connect();
    await connected;

    return client;
  }

  async function rejectConnection(options: Record<string, unknown>) {
    const client = await createClient(options);
    const failed = event<Error>(client, 'connect_error');

    client.connect();

    return failed;
  }

  const subscribe = (client: Socket, id: string) =>
    client
      .timeout(2000)
      .emitWithAck('auction.subscribe', { auctionId: id }) as Promise<SubscriptionAck>;

  it('supports anonymous WebSocket and polling clients with validated subscriptions', async () => {
    const lot = await h.publish();
    const visitor = await connect();
    const polling = await connect(undefined, { transports: ['polling'] });

    expect(await subscribe(visitor, lot.id)).toMatchObject({ ok: true, auctionVersion: 0 });
    expect(await subscribe(polling, lot.id)).toMatchObject({ ok: true });
    expect(await subscribe(visitor, randomUUID())).toEqual({
      ok: false,
      code: 'AUCTION_NOT_FOUND',
    });
    expect(await subscribe(visitor, 'bad')).toEqual({ ok: false, code: 'VALIDATION_ERROR' });
    expect(
      await visitor
        .timeout(2000)
        .emitWithAck('auction.subscribe', { auctionId: lot.id, userId: a.id }),
    ).toEqual({ ok: false, code: 'VALIDATION_ERROR' });
    expect(await visitor.timeout(2000).emitWithAck('wallet.subscribe', { userId: a.id })).toEqual({
      ok: false,
      code: 'VALIDATION_ERROR',
    });

    const cancelled = await h.publish();

    await h.cancel(cancelled.id).expect(200);
    expect(await subscribe(visitor, cancelled.id)).toEqual({
      ok: false,
      code: 'AUCTION_NOT_FOUND',
    });
  });
  it.each(['websocket', 'polling'])(
    'rejects unapproved/missing origins for %s',
    async (transport) => {
      expect(
        await rejectConnection({
          transports: [transport],
          extraHeaders: { Origin: 'https://attacker.example' },
        }),
      ).toBeInstanceOf(Error);
      expect(await rejectConnection({ transports: [transport], extraHeaders: {} })).toBeInstanceOf(
        Error,
      );
    },
  );
  it('rejects invalid/revoked tokens and client-supplied private room identity', async () => {
    for (const auth of [
      { token: 'bad' },
      { userId: a.id },
      { token: a.token, sessionId: randomUUID() },
    ]) {
      expect((await rejectConnection({ auth })).message).toBe('UNAUTHORIZED');
    }

    expect((await rejectConnection({ auth: {}, query: { token: a.token } })).message).toBe(
      'UNAUTHORIZED',
    );
    await h.db.client.authSession.updateMany({
      where: { userId: a.id },
      data: { revokedAt: new Date() },
    });
    expect((await rejectConnection({ auth: { token: a.token } })).message).toBe('UNAUTHORIZED');
  });
  it('broadcasts committed bid/extension events, isolates wallets and permits HTTP refetch', async () => {
    const lot = await h.publish({ endsAt: new Date(h.now.getTime() + 60_000).toISOString() });
    const visitor = await connect();
    const aa = await connect(a);
    const bb = await connect(b);
    const unrelated = await connect(await h.account());

    for (const client of [visitor, aa, bb]) {
      await subscribe(client, lot.id);
    }

    const publicEvents: unknown[] = [];
    const privateLeaks: unknown[] = [];

    visitor.onAny((name, value) => {
      publicEvents.push(value);
      if (['wallet.updated', 'participation.updated'].includes(name)) {
        privateLeaks.push(value);
      }
    });
    unrelated.on('wallet.updated', (value) => privateLeaks.push(value));

    const accepted = event(visitor, 'auction.updated');
    const wallet = event(aa, 'wallet.updated');
    const participation = event(aa, 'participation.updated');
    const extension = new Promise<Record<string, unknown>>((resolve) =>
      visitor.on('auction.updated', (value) => {
        if (value.reason === 'EXTENDED') {
          resolve(value);
        }
      }),
    );

    await h.bid(lot.id, a).expect(201);
    expect(await accepted).toMatchObject({
      auctionId: lot.id,
      auctionVersion: 1,
      reason: 'BID_ACCEPTED',
    });
    expect(await extension).toMatchObject({ reason: 'EXTENDED', auctionVersion: 1 });

    const walletEvent = await wallet;

    expect(walletEvent.walletVersion).toBe((await h.wallet(a)).version);
    await participation;

    const released = event(aa, 'wallet.updated');
    const reserved = event(bb, 'wallet.updated');

    await h.bid(lot.id, b, 1100).expect(201);
    await released;
    await reserved;
    expect((await h.wallet(a)).reservedCents).toBe(0);
    expect((await h.wallet(b)).reservedCents).toBe(1100);
    expect(privateLeaks).toEqual([]);

    const text = JSON.stringify(publicEvents);

    for (const secret of [a.id, b.id, h.seller.id, a.token, process.env.AUDIT_HMAC_SECRET!]) {
      expect(text).not.toContain(secret);
    }

    for (const field of ['wallet', 'email', 'userId', 'bidderId', 'sessionId']) {
      expect(text).not.toContain(`"${field}"`);
    }
  });
  it('emits no accepted bid event for refused bids or idempotent replays', async () => {
    const lot = await h.publish();
    const client = await connect();

    await subscribe(client, lot.id);

    const seen: unknown[] = [];

    client.on('auction.updated', (value) => seen.push(value));
    await h.bid(lot.id, a, 999).expect(409);
    await delay(80);
    expect(seen).toEqual([]);

    const accepted = event(client, 'auction.updated');
    const key = randomUUID();

    await h.bid(lot.id, a, 1000, key).expect(201);
    await accepted;
    seen.length = 0;
    await h.bid(lot.id, a, 1000, key).expect(201);
    await h.bid(lot.id, a, 1100).expect(409);
    await delay(80);
    expect(seen).toEqual([]);
  });
  it('notifies deposits only after the transaction commits and only to its user', async () => {
    const aa = await connect(a);
    const bb = await connect(b);
    const repo = h.app.get(WalletsRepository);
    const credit = repo.credit.bind(repo);
    const seen: unknown[] = [];

    aa.on('wallet.updated', (value) => seen.push(value));
    bb.on('wallet.updated', () => {
      throw new Error('Other wallet leaked');
    });

    let entered!: () => void;
    let release!: () => void;
    const credited = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    jest.spyOn(repo, 'credit').mockImplementationOnce(async (id, amount, tx) => {
      const result = await credit(id, amount, tx);

      entered();
      await gate;

      return result;
    });

    const updated = event(aa, 'wallet.updated');
    const deposit = h
      .deposit(a, 500)
      .expect(201)
      .then((response) => response);

    await credited;
    try {
      await delay(80);
      expect(seen).toEqual([]);
    } finally {
      release();
    }

    await deposit;
    await updated;
    expect((await h.wallet(a)).totalCents).toBe(10_500);
  });
  it('publishes catalogue creation, cancellation, start, confirmation and settlement', async () => {
    const client = await connect();
    const created = event(client, 'catalog.updated');
    const lot = await h.publish();

    expect(await created).toMatchObject({ auctionId: lot.id, status: 'LIVE', auctionVersion: 0 });
    await subscribe(client, lot.id);
    for (const reason of ['STARTED', 'AUDIT_CONFIRMED'] as const) {
      const changed = event(client, 'auction.updated');

      h.app.get(AuctionEvents).publish({ auctionId: lot.id, reason });
      expect(await changed).toMatchObject({ reason });
    }

    const cancelled = event(client, 'auction.updated');

    await h.cancel(lot.id).expect(200);
    expect(await cancelled).toMatchObject({ reason: 'CANCELLED' });

    const sold = await h.publish();

    await h.bid(sold.id, a).expect(201);
    await subscribe(client, sold.id);

    const winner = await connect(a);
    const seller = await connect(h.seller);
    const ended = event(client, 'auction.updated');
    const buyerWallet = event(winner, 'wallet.updated');
    const sellerWallet = event(seller, 'wallet.updated');

    h.now = new Date(sold.endsAt);
    expect(await h.app.get(SettlementsService).settle(sold.id)).toBe('COMPLETED');
    expect(await ended).toMatchObject({ reason: 'ENDED', auctionId: sold.id });
    await buyerWallet;
    await sellerWallet;
    expect((await h.wallet(h.seller)).totalCents).toBe(1000);
  });
  it('unsubscribes per socket and reconnects with a new authoritative snapshot', async () => {
    const lot = await h.publish();
    const aa = await connect();
    const bb = await connect();

    await subscribe(aa, lot.id);
    await subscribe(bb, lot.id);
    expect(
      await aa.timeout(2000).emitWithAck('auction.unsubscribe', { auctionId: lot.id }),
    ).toMatchObject({ ok: true });

    const missing: unknown[] = [];

    aa.on('auction.updated', (value) => missing.push(value));

    const updated = event(bb, 'auction.updated');

    await h.bid(lot.id, a).expect(201);
    await updated;
    expect(missing).toEqual([]);
    bb.disconnect();
    await h.bid(lot.id, b, 1100).expect(201);

    const connected = event(bb, 'connect');

    bb.connect();
    await connected;
    expect(await subscribe(bb, lot.id)).toMatchObject({ ok: true, auctionVersion: 2 });
    expect((await h.detail(lot.id).expect(200)).body.currentBidCents).toBe(1100);
  });
  it('revokes all sockets of the logged-out session without disconnecting another account', async () => {
    const aa = await connect(a);
    const duplicate = await connect(a);
    const bb = await connect(b);
    const revoked = event(aa, 'session.revoked');
    const disconnected = event(duplicate, 'disconnect');

    await request(h.app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://localhost:5173')
      .set('X-CSRF-Protection', '1')
      .set('Authorization', `Bearer ${a.token}`)
      .send({})
      .expect(204);
    expect(await revoked).toEqual({ reason: 'LOGOUT' });
    await disconnected;
    expect(bb.connected).toBe(true);
    expect((await rejectConnection({ auth: { token: a.token } })).message).toBe('UNAUTHORIZED');
  });
  it('expires a valid short-remaining-lifetime JWT and prevents private access afterwards', async () => {
    const jwt = new JwtService();
    const claims = jwt.decode(a.token) as Record<string, unknown>;
    // Leave at least two full seconds for the real database-backed handshake.
    const exp = Math.floor(Date.now() / 1000) + 3;
    const token = jwt.sign(
      { ...claims, iat: exp - 900, exp },
      { secret: Buffer.from(process.env.JWT_SECRET!, 'base64url'), algorithm: 'HS256' },
    );
    const client = await createClient({ auth: { token } });
    // Observe the whole lifecycle before opening the socket, including immediate events.
    const lifecycle = Promise.all([
      event(client, 'connect'),
      event(client, 'auth.expired', 5000),
      event(client, 'disconnect', 5000),
    ]);

    client.connect();

    const [, expired] = await lifecycle;

    expect(expired).toEqual({ reason: 'TOKEN_EXPIRED' });
    expect(client.connected).toBe(false);

    // A timer may wake just before the wall-clock JWT boundary. Reconnection tests
    // token expiry, so wait for exp itself rather than assuming disconnect proves it.
    while (Date.now() < exp * 1000) {
      await delay(exp * 1000 - Date.now());
    }

    await request(h.app.getHttpServer())
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect((await rejectConnection({ auth: { token } })).message).toBe('UNAUTHORIZED');
  });
  it('rechecks persisted sessions before private emission', async () => {
    const client = await connect(a);
    const seen: unknown[] = [];

    client.on('wallet.updated', (value) => seen.push(value));

    const disconnected = event(client, 'disconnect');

    await h.db.client.authSession.updateMany({
      where: { userId: a.id },
      data: { revokedAt: new Date() },
    });

    // Another valid session can deposit for this user, but the revoked socket must receive nothing.
    const sessions = h.app.get(SessionsService);
    const user = await h.db.client.user.findUniqueOrThrow({ where: { id: a.id } });
    const issued = await h.db.transaction((tx) => sessions.issue(user, tx));

    await h.deposit({ id: a.id, token: issued.response.accessToken }, 100).expect(201);
    await disconnected;
    expect(seen).toEqual([]);
  });
  it('bounds subscription traffic and sanitizes database errors', async () => {
    const client = await connect();
    const lot = await h.publish();

    jest
      .spyOn(h.app.get(RealtimeRepository), 'lot')
      .mockRejectedValueOnce(new Error('postgres://private-secret'));
    expect(await subscribe(client, lot.id)).toEqual({ ok: false, code: 'UNAVAILABLE' });
    for (let i = 0; i < 59; i++) {
      await subscribe(client, 'invalid');
    }

    expect(await subscribe(client, lot.id)).toEqual({ ok: false, code: 'LIMIT_EXCEEDED' });
  });
});
