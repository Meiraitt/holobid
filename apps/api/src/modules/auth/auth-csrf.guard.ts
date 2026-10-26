import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { ApiEnvironment } from '../../config/environment';
import { ApiException } from '../../common/http/api.exception';

@Injectable()
export class AuthCsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService<ApiEnvironment, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.origin !== this.config.get('WEB_ORIGIN', { infer: true }) ||
        request.headers['x-csrf-protection'] !== '1' || !request.is('application/json')) {
      throw new ApiException(403, 'INVALID_ORIGIN', 'Origin or CSRF protection is invalid.');
    }
    return true;
  }
}
