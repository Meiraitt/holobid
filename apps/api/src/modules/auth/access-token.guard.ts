import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccessTokenService } from './access-token.service';
import { UsersRepository } from '../users/users.repository';
import { AuthenticatedRequest, publicUser } from './auth-user';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly tokens: AccessTokenService, private readonly users: UsersRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization || authorization.length > 4096 || !/^Bearer [^ ]+$/i.test(authorization)) {
      throw new UnauthorizedException();
    }
    const claims = await this.tokens.verify(authorization.slice(7));
    const user = await this.users.findById(claims.sub);
    if (!user) throw new UnauthorizedException();
    request.user = publicUser(user);
    return true;
  }
}
