import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { FixedWindowLimiter } from '../../common/http/fixed-window-limiter';
import { RateLimitException } from '../../common/http/rate-limit.exception';
import type { AuthenticatedRequest } from '../auth/auth-user';

@Injectable()
export class CatalogRateLimitGuard implements CanActivate {
  private readonly limiter = new FixedWindowLimiter(30);

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    const retryAfter = this.limiter.consume(user.id);

    if (retryAfter !== null) {
      throw new RateLimitException(retryAfter);
    }

    return true;
  }
}
