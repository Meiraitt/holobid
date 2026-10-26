import { HttpStatus } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from './config/environment';
import { ApiException } from './common/http/api.exception';
import { ApiExceptionFilter } from './common/http/api-exception.filter';
import { requestContext } from './common/http/request-context.middleware';
import { createValidationPipe } from './common/http/validation.pipe';

export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService<ApiEnvironment, true>);
  const allowedOrigin = config.get('WEB_ORIGIN', { infer: true });
  app.disable('x-powered-by');
  app.setGlobalPrefix('api/v1');
  app.use(requestContext);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || origin === allowedOrigin) return callback(null, true);
      callback(new ApiException(HttpStatus.FORBIDDEN, 'INVALID_ORIGIN', 'Origin is not allowed.'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-CSRF-Protection'],
    exposedHeaders: ['X-Request-ID'],
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());
}
