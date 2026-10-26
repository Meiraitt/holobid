import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnApplicationBootstrap, BeforeApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SubscriptionAck } from '@holobid/contracts';
import type { ApiEnvironment } from '../../config/environment';
import { SessionsService } from '../auth/sessions.service';
import { SessionRevocationEvents } from '../auth/session-revocation.events';
import { AuctionEvents, AuctionChange } from '../auctions/auction-events';
import { AuctionClock } from '../auctions/auction-clock';
import { auctionStatus } from '../auctions/auction.presenter';
import { WalletEvents } from '../wallets/wallet-events';
import { RealtimeRepository } from './realtime.repository';

type Data = { token?: string; identity?: Awaited<ReturnType<SessionsService['authenticate']>>; revision: number;
  expiry?: ReturnType<typeof setTimeout>; rooms: Set<string>; chain: Promise<void>; window: number; count: number };
type Client = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, Data>;
@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private io?: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, Data>;
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly unsubscribe: Array<() => void> = [];
  private readonly jobs = new Set<Promise<void>>();
  constructor(private readonly host: HttpAdapterHost, private readonly config: ConfigService<ApiEnvironment, true>,
    private readonly sessions: SessionsService, private readonly revocations: SessionRevocationEvents, private readonly auctions: AuctionEvents,
    private readonly wallets: WalletEvents, private readonly repository: RealtimeRepository, private readonly clock: AuctionClock) {}
  onApplicationBootstrap() {
    const http = this.host.httpAdapter?.getHttpServer(); if (!http) return; // CLI application contexts have no transport.
    const origin = this.config.get('WEB_ORIGIN', { infer: true });
    this.io = new Server(http, { path: '/socket.io', cors: { origin, credentials: false }, maxHttpBufferSize: 8192,
      allowRequest: (req, done) => done(null, req.headers.origin === origin && (this.io?.engine.clientsCount ?? 0) < 1000) });
    this.io.use((socket, next) => { void this.authenticate(socket).then(() => next(), () => next(new Error('UNAUTHORIZED'))); });
    this.io.on('connection', socket => this.connect(socket));
    this.unsubscribe.push(this.auctions.subscribe(event => {
      if (event.reason !== 'RECHECK') this.run(() => this.auctionChanged(event));
    }), this.wallets.subscribe(id => this.run(() => this.privateUpdates([id]))), this.revocations.onRevoked(id => {
      for (const socket of this.io?.sockets.sockets.values() ?? []) if (socket.data.identity?.sessionId === id) {
        socket.emit('session.revoked', { reason: 'LOGOUT' }); socket.disconnect(true);
      }
    }));
  }
  private async authenticate(socket: Client) {
    const auth: unknown = socket.handshake.auth;
    if (!auth || typeof auth !== 'object' || Array.isArray(auth) || Object.keys(auth).some(key => key !== 'token')) throw new Error();
    const token: unknown = (auth as { token?: unknown }).token;
    if (token !== undefined && (typeof token !== 'string' || !token || token.length > 4096)) throw new Error();
    if (['token', 'userId', 'sessionId'].some(key => key in socket.handshake.query)) throw new Error();
    const revision = this.revocations.revision;
    const identity = typeof token === 'string' ? await this.sessions.authenticate(token) : undefined;
    if (identity && revision !== this.revocations.revision) throw new Error();
    socket.data = { token: token as string | undefined, identity, revision, rooms: new Set(), chain: Promise.resolve(), window: Date.now(), count: 0 };
  }
  private connect(socket: Client) {
    const identity = socket.data.identity;
    if (identity && (socket.data.revision !== this.revocations.revision || identity.expiresAt.getTime() <= Date.now())) { socket.disconnect(true); return; }
    void socket.join('catalog');
    if (identity) {
      void socket.join(`user:${identity.user.id}`); void socket.join(`session:${identity.sessionId}`);
      socket.data.expiry = setTimeout(() => this.expire(socket), identity.expiresAt.getTime() - Date.now()); socket.data.expiry.unref();
    }
    socket.on('disconnect', () => { clearTimeout(socket.data.expiry); socket.data.rooms.clear(); });
    socket.on('auction.subscribe', (input, ack) => this.subscription(socket, input, ack, true));
    socket.on('auction.unsubscribe', (input, ack) => this.subscription(socket, input, ack, false));
    socket.onAny((event: string, _input: unknown, ack: unknown) => {
      if (!['auction.subscribe', 'auction.unsubscribe'].includes(event) && typeof ack === 'function') ack({ ok: false, code: 'VALIDATION_ERROR' });
    });
  }
  private expire(socket: Client) { if (socket.connected) { socket.emit('auth.expired', { reason: 'TOKEN_EXPIRED' }); socket.disconnect(true); } }
  private subscription(socket: Client, input: unknown, ack: (result: SubscriptionAck) => void, join: boolean) {
    if (typeof ack !== 'function') return;
    if (Date.now() - socket.data.window >= 60_000) { socket.data.window = Date.now(); socket.data.count = 0; }
    if (++socket.data.count > 60) { ack({ ok: false, code: 'LIMIT_EXCEEDED' }); return; }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 ||
        !('auctionId' in input) || typeof input.auctionId !== 'string' || !isUUID(input.auctionId, '4')) { ack({ ok: false, code: 'VALIDATION_ERROR' }); return; }
    const id = input.auctionId.toLowerCase();
    socket.data.chain = socket.data.chain.then(async () => {
      if (!socket.connected) return;
      if (socket.data.identity && socket.data.identity.expiresAt.getTime() <= Date.now()) { this.expire(socket); return; }
      if (!join) { await socket.leave(`auction:${id}`); socket.data.rooms.delete(id); ack({ ok: true, serverTime: this.clock.now().toISOString() }); return; }
      if (!socket.data.rooms.has(id) && socket.data.rooms.size >= 20) { ack({ ok: false, code: 'LIMIT_EXCEEDED' }); return; }
      // Join before reading. Changes during the read cannot fall in a subscribe/GET gap.
      const alreadyJoined = socket.data.rooms.has(id); await socket.join(`auction:${id}`);
      try {
        const lot = await this.repository.lot(id);
        if (!lot || lot.lifecycle === 'CANCELLED') {
          await socket.leave(`auction:${id}`); socket.data.rooms.delete(id); ack({ ok: false, code: 'AUCTION_NOT_FOUND' }); return;
        }
        if (!socket.connected) return;
        socket.data.rooms.add(id); ack({ ok: true, auctionVersion: lot.version, serverTime: this.clock.now().toISOString() });
      } catch {
        if (!alreadyJoined) await socket.leave(`auction:${id}`);
        ack({ ok: false, code: 'UNAVAILABLE' });
      }
    }).catch(() => { ack({ ok: false, code: 'UNAVAILABLE' }); });
  }
  private run(work: () => Promise<void>) {
    if (!this.io || this.io.sockets.sockets.size === 0 || this.jobs.size >= 1000) return;
    const job = work().catch(() => this.logger.error({ event: 'realtime.notification_failed' })).finally(() => this.jobs.delete(job));
    this.jobs.add(job);
  }
  private async auctionChanged(event: AuctionChange) {
    if (!this.io || event.reason === 'RECHECK') return;
    const lot = await this.repository.lot(event.auctionId); if (!lot || !this.io) return;
    const base = { auctionId: lot.id, auctionVersion: lot.version, serverTime: this.clock.now().toISOString() };
    if (event.reason !== 'PUBLISHED') this.io.to(`auction:${lot.id}`).emit('auction.updated', { ...base, eventId: randomUUID(), reason: event.reason });
    if (event.extended) this.io.to(`auction:${lot.id}`).emit('auction.updated', { ...base, eventId: randomUUID(), reason: 'EXTENDED' });
    this.io.to('catalog').emit('catalog.updated', { ...base, eventId: randomUUID(), status: auctionStatus(lot, this.clock.now()) });
    const connected = [...new Set([...this.io.sockets.sockets.values()].flatMap(socket => socket.data.identity ? [socket.data.identity.user.id] : []))];
    if (connected.length) {
      const affected = await this.repository.affected(lot.id, connected);
      await this.privateUpdates(affected.map(user => user.id), lot.id);
    }
  }
  private async privateUpdates(ids: string[], auctionId?: string) {
    if (!this.io) return;
    const targets = [...this.io.sockets.sockets.values()].filter(socket => socket.data.identity && ids.includes(socket.data.identity.user.id));
    if (!targets.length) return;
    const versions = await this.repository.wallets([...new Set(targets.map(socket => socket.data.identity!.user.id))]);
    for (const socket of targets) {
      try {
        const identity = await this.sessions.authenticate(socket.data.token!);
        if (!socket.connected) continue;
        if (identity.expiresAt.getTime() <= Date.now()) { this.expire(socket); continue; }
        const wallet = versions.find(row => row.userId === identity.user.id);
        if (wallet) socket.emit('wallet.updated', { eventId: randomUUID(), walletVersion: wallet.version, serverTime: this.clock.now().toISOString() });
        if (auctionId) socket.emit('participation.updated', { eventId: randomUUID(), auctionId, serverTime: this.clock.now().toISOString() });
      } catch { socket.disconnect(true); } // A revoked/unreadable session receives no private data.
    }
  }
  async beforeApplicationShutdown() {
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    const io = this.io; this.io = undefined;
    if (io) await new Promise<void>(resolve => { void io.close(() => resolve()); });
    await Promise.allSettled(this.jobs);
  }
}
