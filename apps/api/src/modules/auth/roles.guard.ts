import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { UserRole } from '@holobid/contracts';

import { AccessTokenGuard } from './access-token.guard';
import type { AuthenticatedRequest } from './auth-user';

const ROLES = 'holobid:roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;

    if (!user) {
      throw new UnauthorizedException();
    }

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException();
    }

    return true;
  }
}

// Couples role checks to session authentication so a role decorator cannot bypass it.
export function RequireRoles(...roles: UserRole[]) {
  return applyDecorators(SetMetadata(ROLES, roles), UseGuards(AccessTokenGuard, RolesGuard));
}
