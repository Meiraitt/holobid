import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import type { AuthenticatedRequest } from './auth-user';
import { SessionsService } from './sessions.service';

export function readBearer(authorization: string | undefined): string | null {
  return authorization && authorization.length <= 4096 && /^Bearer [^ ]+$/i.test(authorization)
    ? authorization.slice(7)
    : null;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearer(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException();
    }

    const identity = await this.sessions.authenticate(token);

    request.user = identity.user;
    request.sessionId = identity.sessionId;

    return true;
  }
}
