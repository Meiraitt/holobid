import 'reflect-metadata';

import process from 'node:process';

import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { type ApiEnvironment, EnvironmentValidationError } from './config/environment';
import { configureApp } from './configure-app';

const logger = new ConsoleLogger({ json: true, colors: false });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    abortOnError: false,
  });

  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get(ConfigService<ApiEnvironment, true>);

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

void bootstrap().catch((error: unknown) => {
  logger.error(
    error instanceof EnvironmentValidationError ? error.message : 'Application failed to start.',
  );
  process.exitCode = 1;
});
