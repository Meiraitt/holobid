import { createHash, randomBytes } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';

import type { AuthResponse, AuthUser } from '@holobid/contracts';

import { ApiException } from '../../common/http/api.exception';
import { DatabaseService, TransactionContext } from '../../database/database.service';

import { AccessTokenService } from './access-token.service';
import { publicUser } from './auth-user';
import { SessionRevocationEvents } from './session-revocation.events';
import { SessionsRepository } from './sessions.repository';

export interface SessionResult {
  response: AuthResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function validRefresh(token: string | null): token is string {
  return (
    token !== null &&
    /^[A-Za-z0-9_-]{43}$/.test(token) &&
    Buffer.from(token, 'base64url').toString('base64url') === token
  );
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly sessions: SessionsRepository,
    private readonly tokens: AccessTokenService,
    private readonly events: SessionRevocationEvents,
  ) {}

  async issue(user: AuthUser, tx: TransactionContext): Promise<SessionResult> {
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const session = await this.sessions.create(user.id, tokenHash(refreshToken), expiresAt, tx);

    return this.result(user, session.id, refreshToken, expiresAt);
  }

  async refresh(token: string | null): Promise<SessionResult> {
    if (!validRefresh(token)) {
      throw this.invalidRefresh();
    }

    const currentHash = tokenHash(token);
    const session = await this.sessions.findByRefreshHash(currentHash);

    if (!session) {
      throw this.invalidRefresh();
    }

    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new ApiException(401, 'SESSION_EXPIRED', 'Session has expired.');
    }

    const next = randomBytes(32).toString('base64url');

    return this.database.transaction(async (tx) => {
      const updated = await this.sessions.rotate(session.id, currentHash, tokenHash(next), tx);

      if (updated.count !== 1) {
        throw this.invalidRefresh();
      }

      return this.result(session.user, session.id, next, session.expiresAt);
    });
  }

  async authenticate(accessToken: string) {
    const claims = await this.tokens.verify(accessToken);
    const session = await this.sessions.findActive(claims.sid, claims.sub);

    if (!session) {
      throw new UnauthorizedException();
    }

    return {
      user: publicUser(session.user),
      sessionId: session.id,
      expiresAt: new Date(Math.min(claims.exp * 1000, session.expiresAt.getTime())),
    };
  }

  async logout(refreshToken: string | null, accessToken: string | null): Promise<void> {
    let identity: { id: string; userId: string } | null = null;

    // A bearer token identifies the session even when refresh rotated concurrently.
    if (accessToken) {
      try {
        const claims = await this.tokens.verify(accessToken);

        identity = { id: claims.sid, userId: claims.sub };
      } catch {
        /* An expired access token can still be logged out via its refresh cookie. */
      }
    }

    if (!identity && validRefresh(refreshToken)) {
      const session = await this.sessions.findByRefreshHash(tokenHash(refreshToken));

      if (session) {
        identity = { id: session.id, userId: session.userId };
      }
    }

    if (!identity) {
      return;
    }

    const { id, userId } = identity;
    const updated = await this.database.transaction((tx) => this.sessions.revoke(id, userId, tx));

    if (updated.count > 0) {
      this.events.publish(id);
    }
  }

  private async result(
    user: AuthUser,
    sessionId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): Promise<SessionResult> {
    return {
      response: {
        user: publicUser(user),
        accessToken: await this.tokens.sign(user, sessionId),
        expiresIn: 900,
      },
      refreshToken,
      refreshExpiresAt,
    };
  }

  private invalidRefresh(): ApiException {
    return new ApiException(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid.');
  }
}
