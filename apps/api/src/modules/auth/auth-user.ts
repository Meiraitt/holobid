import type { AuthUser } from '@holobid/contracts';
import type { Request } from 'express';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser =>
  context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

export function publicUser(user: AuthUser): AuthUser {
  return { id: user.id, email: user.email, role: user.role };
}
