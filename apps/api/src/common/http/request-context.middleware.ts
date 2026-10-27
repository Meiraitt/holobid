import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

export function requestContext(request: Request, response: Response, next: NextFunction): void {
  const requestId = randomUUID();
  const startedAt = performance.now();

  response.setHeader('X-Request-ID', requestId);
  response.setHeader('Cache-Control', 'no-store');

  response.once('finish', () => {
    // Log a fixed allowlist, never bodies, headers, query strings or raw URLs.
    logger.log({
      event: 'http.request',
      requestId,
      method: request.method,
      statusCode: response.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    });
  });
  next();
}
