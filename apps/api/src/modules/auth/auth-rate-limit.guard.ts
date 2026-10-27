import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthRateLimiter, rateLimitError } from './auth-rate-limiter';

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: AuthRateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    // Express does not trust forwarding headers unless explicitly configured for the deploy.
    const retryAfter = this.limiter.consume(
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      request.body?.email,
    );

    if (retryAfter !== null) {
      http.getResponse<Response>().setHeader('Retry-After', retryAfter);
      throw rateLimitError();
    }

    return true;
  }
}
