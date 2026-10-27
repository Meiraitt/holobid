import { randomUUID } from 'node:crypto';

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import type { ApiError } from '@holobid/contracts';

import { ApiException } from './api.exception';
import { RateLimitException } from './rate-limit.exception';

const defaults: Record<number, { code: string; message: string }> = {
  400: { code: 'VALIDATION_ERROR', message: 'Invalid request.' },
  401: { code: 'UNAUTHORIZED', message: 'Authentication is required.' },
  403: { code: 'FORBIDDEN', message: 'Access is denied.' },
  404: { code: 'NOT_FOUND', message: 'Resource not found.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests.' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'Service is unavailable.' },
};

function getStatus(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }

  if (exception instanceof Error && 'type' in exception && exception.type === 'entity.too.large') {
    return HttpStatus.PAYLOAD_TOO_LARGE;
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = String(response.getHeader('X-Request-ID') ?? randomUUID());
    const status = getStatus(exception);
    const fallback = defaults[status] ?? {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    };
    const body: ApiError =
      exception instanceof ApiException
        ? {
            code: exception.code,
            message: exception.message,
            requestId,
            ...(exception.details ? { details: exception.details } : {}),
          }
        : { ...fallback, requestId };

    if (status >= 500) {
      this.logger.error({ event: 'http.error', requestId, statusCode: status, code: body.code });
    }

    if (!response.headersSent) {
      if (exception instanceof RateLimitException) {
        response.setHeader('Retry-After', exception.retryAfter);
      }

      response.setHeader('X-Request-ID', requestId);
      response.status(status).json(body);
    }
  }
}
