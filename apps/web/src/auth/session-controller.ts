import type { AuthResponse, AuthUser, CredentialsInput } from '@holobid/contracts';

import { ApiRequestError } from '../services/api-error';
import type { authService } from '../services/auth-service';

export type SessionSnapshot = {
  status: 'restoring' | 'authenticated' | 'anonymous' | 'unavailable';
  user: AuthUser | null;
  expiresAt: number;
};

export interface SessionCoordinator {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  signedOut(): boolean;
  publish(state: 'active' | 'signed-out'): void;
  subscribe(listener: (state: 'active' | 'signed-out') => void): () => void;
}

export class SessionController {
  private snapshot: SessionSnapshot = { status: 'restoring', user: null, expiresAt: 0 };

  private accessToken: string | null = null;

  private generation = 0;

  private renewal: Promise<string | null> | null = null;

  private renewalGeneration = -1;

  private signingIn = false;

  private logoutToken?: string;

  private listeners = new Set<() => void>();

  constructor(
    private readonly api: ReturnType<typeof authService>,
    private readonly coordination: SessionCoordinator,
    private readonly clearPrivate: () => void,
  ) {}

  getSnapshot = () => this.snapshot;

  token = () => this.accessToken;

  scope = () => this.generation;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  connect = () =>
    this.coordination.subscribe((state) => {
      this.clear('anonymous');
      if (state === 'active') {
        void this.restore();
      }
    });

  private update(snapshot: SessionSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private clear(status: SessionSnapshot['status']) {
    this.generation++;
    this.accessToken = null;
    this.clearPrivate();
    this.update({ status, user: null, expiresAt: 0 });
  }

  private accept(result: AuthResponse) {
    if (this.snapshot.user && this.snapshot.user.id !== result.user.id) {
      this.clear('anonymous');
    }

    this.accessToken = result.accessToken;
    this.update({
      status: 'authenticated',
      user: result.user,
      expiresAt: Date.now() + result.expiresIn * 1000,
    });
  }

  restore = async () => {
    if (this.coordination.signedOut()) {
      this.clear('anonymous');

      return;
    }

    if (this.snapshot.status !== 'authenticated') {
      this.update({ ...this.snapshot, status: 'restoring' });
    }

    try {
      await this.refresh(this.accessToken);
    } catch {
      // The snapshot distinguishes a rejected session from an unavailable server.
    }
  };

  refresh = (rejectedToken: string | null): Promise<string | null> => {
    if (this.accessToken && rejectedToken !== this.accessToken) {
      return Promise.resolve(this.accessToken);
    }

    if (this.renewal) {
      if (this.renewalGeneration !== this.generation) {
        return this.renewal.catch(() => null).then(() => this.refresh(this.accessToken));
      }

      return this.renewal;
    }

    const generation = this.generation;
    const task = this.coordination.exclusive(async () => {
      if (generation !== this.generation || this.coordination.signedOut()) {
        return null;
      }

      try {
        const result = await this.api.refresh();

        if (generation !== this.generation || this.coordination.signedOut()) {
          return null;
        }

        this.accept(result);

        return this.accessToken;
      } catch (error) {
        if (generation === this.generation) {
          this.clear(
            error instanceof ApiRequestError && error.status === 401 ? 'anonymous' : 'unavailable',
          );
        }

        throw error;
      }
    });

    this.renewal = task;
    this.renewalGeneration = generation;
    void task
      .finally(() => {
        if (this.renewal === task) {
          this.renewal = null;
        }
      })
      .catch(() => {});

    return task;
  };

  signIn = async (kind: 'login' | 'register', input: CredentialsInput): Promise<AuthUser> => {
    if (this.signingIn) {
      throw new ApiRequestError('aborted');
    }

    this.signingIn = true;
    this.clear('anonymous');
    this.coordination.publish('signed-out');

    const generation = this.generation;

    try {
      return await this.coordination.exclusive(async () => {
        const result = await this.api[kind](input);

        if (generation !== this.generation) {
          throw new ApiRequestError('aborted');
        }

        this.accept(result);
        this.coordination.publish('active');

        return result.user;
      });
    } finally {
      this.signingIn = false;
    }
  };

  logout = async () => {
    this.logoutToken = this.accessToken ?? this.logoutToken;
    this.clear('anonymous');
    this.coordination.publish('signed-out');
    await this.coordination.exclusive(async () => {
      await this.api.logout(this.logoutToken);
      this.logoutToken = undefined;
    });
  };
}
