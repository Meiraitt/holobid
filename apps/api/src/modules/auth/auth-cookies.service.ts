import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';

import type { ApiEnvironment } from '../../config/environment';

import type { SessionResult } from './sessions.service';

@Injectable()
export class AuthCookiesService {
  private readonly name = 'holobid_refresh';

  private readonly options: CookieOptions;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.options = {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
      secure: config.get('NODE_ENV', { infer: true }) === 'production',
    };
  }

  read(request: Request): string | null {
    const values = (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${this.name}=`));

    if (values.length !== 1) {
      return null;
    }

    const value = values[0]!.slice(this.name.length + 1);

    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  set(response: Response, session: SessionResult): void {
    response.cookie(this.name, session.refreshToken, {
      ...this.options,
      expires: session.refreshExpiresAt,
      maxAge: Math.max(0, session.refreshExpiresAt.getTime() - Date.now()),
    });
  }

  clear(response: Response): void {
    response.clearCookie(this.name, this.options);
  }
}
