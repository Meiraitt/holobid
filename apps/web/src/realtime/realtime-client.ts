import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';

import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SubscriptionAck,
  WalletResponse,
} from '@holobid/contracts';

import type { SessionController } from '../auth/session-controller';
import { queryKeys } from '../lib/query-client';
import { apiOrigin } from '../services/api-client';

import { EventGate } from './event-gate';

type LiveSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

type Session = Pick<
  SessionController,
  'getSnapshot' | 'subscribe' | 'token' | 'refresh' | 'revoke'
>;

type RoomState = 'joining' | 'joined' | 'missing' | 'unavailable';

type Room = { count: number; state: RoomState };

export type RealtimeSnapshot = {
  phase: 'connecting' | 'disconnected' | 'syncing' | 'ready' | 'unavailable';
  rooms: Readonly<Record<string, RoomState>>;
};

export function socketFactory(origin: string) {
  return (token: string | null): LiveSocket =>
    io(apiOrigin(origin), {
      path: '/socket.io',
      autoConnect: false,
      forceNew: true,
      transports: ['websocket', 'polling'],
      tryAllTransports: true,
      withCredentials: false,
      auth: token ? { token } : {},
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
}

export class RealtimeClient {
  private socket?: LiveSocket;

  private unsubscribeSession?: () => void;

  private credentials = '';

  private epoch = 0;

  private active = false;

  private running = false;

  private timer?: ReturnType<typeof setTimeout>;

  private readonly rooms = new Map<string, Room>();

  private readonly pending = new Map<string, QueryKey>();

  private readonly listeners = new Set<() => void>();

  private snapshot: RealtimeSnapshot = { phase: 'disconnected', rooms: {} };

  private renewingToken?: string;

  constructor(
    private readonly cache: QueryClient,
    private readonly session: Session,
    private readonly createSocket: (token: string | null) => LiveSocket,
  ) {}

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  start = () => {
    if (this.active) {
      return this.stop;
    }

    this.active = true;
    this.unsubscribeSession = this.session.subscribe(this.configure);
    this.configure();

    return this.stop;
  };

  stop = () => {
    this.active = false;
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    this.credentials = '';
    this.detach();
    this.update('disconnected');
  };

  private update(phase = this.snapshot.phase) {
    this.snapshot = {
      phase,
      rooms: Object.fromEntries([...this.rooms].map(([id, room]) => [id, room.state])),
    };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private detach() {
    this.epoch++;
    clearTimeout(this.timer);
    this.pending.clear();
    this.running = false;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = undefined;
    for (const room of this.rooms.values()) {
      room.state = 'joining';
    }
  }

  private configure = () => {
    const token = this.session.token();
    const { user, status } = this.session.getSnapshot();
    const credentials = `${status}:${user?.id ?? ''}:${token ?? ''}`;

    if (!this.active || credentials === this.credentials) {
      return;
    }

    this.credentials = credentials;
    this.detach();
    this.update('connecting');

    const socket = this.createSocket(token);
    const userId = user?.id;
    const gate = new EventGate();
    const current = () => this.active && this.socket === socket;
    const privateKeys = userId ? [['private', userId] as const] : [];
    const publicAndPrivate = [['public'], ...privateKeys];
    const walletKey = queryKeys.private(userId ?? '', 'wallet');

    this.socket = socket;
    socket.on('connect', () => {
      if (!current()) {
        return;
      }

      this.epoch++;
      this.update('syncing');
      void Promise.all([...this.rooms].map(([id, room]) => this.join(socket, id, room))).then(
        () => {
          if (current() && socket.connected) {
            this.requestSync(publicAndPrivate);
          }
        },
      );
    });
    socket.on('disconnect', (reason) => {
      if (!current()) {
        return;
      }

      this.epoch++;
      clearTimeout(this.timer);
      this.pending.clear();
      this.running = false;
      for (const room of this.rooms.values()) {
        room.state = 'joining';
      }

      this.update('disconnected');
      if (reason === 'io server disconnect' && token) {
        void this.renew(token, current);
      }
    });
    socket.on('connect_error', (error) => {
      if (!current()) {
        return;
      }

      this.update('disconnected');
      if (error.message === 'UNAUTHORIZED' && token) {
        void this.renew(token, current);
      }
    });
    socket.on('auth.expired', () => {
      if (current() && token) {
        void this.renew(token, current);
      }
    });
    socket.on('session.revoked', () => {
      if (current()) {
        this.session.revoke();
      }
    });
    socket.on('auction.updated', (event) => {
      const version = this.cache.getQueryData<{ auction: { version: number } }>([
        'public',
        'room',
        event.auctionId,
      ])?.auction.version;

      if (
        !current() ||
        !this.rooms.has(event.auctionId) ||
        !gate.accept(event.eventId, `lot:${event.auctionId}`, event.auctionVersion, version)
      ) {
        return;
      }

      this.requestSync([
        ['public', 'room', event.auctionId],
        ['public', 'auction', event.auctionId],
        ['public', 'bid-history', event.auctionId],
        ...privateKeys,
      ]);
    });
    socket.on('catalog.updated', (event) => {
      if (
        current() &&
        gate.accept(event.eventId, `catalog:${event.auctionId}`, event.auctionVersion)
      ) {
        this.requestSync([['public', 'auctions'], ...privateKeys]);
      }
    });
    socket.on('wallet.updated', (event) => {
      const version = this.cache.getQueryData<WalletResponse>(walletKey)?.version;

      if (
        current() &&
        userId &&
        gate.accept(event.eventId, 'wallet', event.walletVersion, version)
      ) {
        this.requestSync([walletKey, queryKeys.private(userId, 'auctioneer-summary')]);
      }
    });
    socket.on('participation.updated', (event) => {
      if (current() && userId && gate.accept(event.eventId, 'participation')) {
        this.requestSync([
          queryKeys.private(userId, 'auction-position', { id: event.auctionId }),
          ['private', userId, 'participations'],
        ]);
      }
    });
    socket.connect();
  };

  private async renew(token: string, current: () => boolean) {
    if (this.renewingToken === token) {
      return;
    }

    this.renewingToken = token;
    this.update('disconnected');
    this.socket?.disconnect();
    try {
      const renewed = await this.session.refresh(token);

      if (current() && renewed) {
        this.retry();
      }
    } catch {
      // SessionController clears private state and distinguishes outage from rejection.
    }
  }

  watchAuction = (id: string) => {
    const room = this.rooms.get(id) ?? { count: 0, state: 'joining' as const };

    room.count++;
    this.rooms.set(id, room);
    this.update();
    if (room.count === 1 && this.socket?.connected) {
      void this.join(this.socket, id, room);
    }

    let watching = true;

    return () => {
      if (!watching) {
        return;
      }

      watching = false;
      if (--room.count > 0) {
        return;
      }

      this.rooms.delete(id);
      if (this.socket?.connected) {
        this.socket.timeout(5000).emit('auction.unsubscribe', { auctionId: id }, () => {});
      }

      this.update();
    };
  };

  private async join(socket: LiveSocket, id: string, room: Room) {
    room.state = 'joining';
    this.update();

    const epoch = this.epoch;
    const ack = await new Promise<SubscriptionAck>((resolve) => {
      socket.timeout(5000).emit('auction.subscribe', { auctionId: id }, (error, result) => {
        resolve(error ? { ok: false, code: 'UNAVAILABLE' } : result);
      });
    });

    if (
      this.socket !== socket ||
      this.epoch !== epoch ||
      !socket.connected ||
      this.rooms.get(id) !== room
    ) {
      return;
    }

    room.state = ack.ok
      ? 'joined'
      : ack.code === 'AUCTION_NOT_FOUND' || ack.code === 'VALIDATION_ERROR'
        ? 'missing'
        : 'unavailable';
    this.update();
    if (room.state !== 'unavailable') {
      this.requestSync(this.allKeys());
    }
  }

  private allKeys(): QueryKey[] {
    const user = this.session.getSnapshot().user;

    return [['public'], ...(user ? [['private', user.id]] : [])];
  }

  retry = () => {
    if (!this.socket?.connected) {
      this.socket?.connect();

      return;
    }

    void Promise.all([...this.rooms].map(([id, room]) => this.join(this.socket!, id, room))).then(
      () => this.requestSync(this.allKeys()),
    );
  };

  private requestSync(keys: QueryKey[]) {
    if (!this.socket?.connected) {
      return;
    }

    for (const key of keys) {
      this.pending.set(JSON.stringify(key), key);
    }

    this.update('syncing');
    if (this.running) {
      return;
    }

    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.synchronize();
    }, 25);
  }

  private async synchronize() {
    const epoch = this.epoch;
    const current = () => this.active && epoch === this.epoch && this.socket?.connected;

    if (!current() || this.running) {
      return;
    }

    this.running = true;

    let failed = false;

    // Events received during a GET schedule another pass. Cancelling prior reads also
    // closes the subscribe/initial-snapshot race; no event payload becomes balance data.
    while (this.pending.size && current()) {
      const queued = [...this.pending.values()];
      const keys = queued.filter(
        (key) =>
          !queued.some(
            (parent) =>
              parent.length < key.length &&
              parent.every((part, index) => JSON.stringify(part) === JSON.stringify(key[index])),
          ),
      );

      this.pending.clear();
      await Promise.all(keys.map((queryKey) => this.cache.cancelQueries({ queryKey })));
      if (!current()) {
        return;
      }

      const results = await Promise.allSettled(
        keys.map((queryKey) =>
          this.cache.invalidateQueries({ queryKey }, { throwOnError: true, cancelRefetch: false }),
        ),
      );

      failed ||= results.some((result) => result.status === 'rejected');
    }

    if (current()) {
      this.running = false;
      this.update(failed ? 'unavailable' : 'ready');
    }
  }
}
