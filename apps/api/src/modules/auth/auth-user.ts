import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthUser } from '@holobid/contracts';

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  sessionId: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

export function publicUser(user: AuthUser): AuthUser {
  return { id: user.id, email: user.email, role: user.role };
}
