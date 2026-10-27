import 'reflect-metadata';

import process from 'node:process';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { isUUID } from 'class-validator';

import { validateEnvironment } from '../config/environment';
import { AuditModule } from '../modules/audit/audit.module';
import { AuditService } from '../modules/audit/audit.service';

async function main() {
  const [flag, id, ...extra] = process.argv.slice(2);

  if (flag !== '--auction-id' || !id || !isUUID(id, '4') || extra.length) {
    throw new Error('Usage: audit:verify -- --auction-id <uuid>');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('The audit CLI is disabled in production.');
  }

  @Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: process.env.NODE_ENV === 'test',
        validate: validateEnvironment,
      }),
      AuditModule,
    ],
  })
  class AuditCliModule {}

  // Only audit providers: no HTTP server, scheduler, reconciliation or mutation.
  const app = await NestFactory.createApplicationContext(AuditCliModule, {
    logger: false,
    abortOnError: false,
  });

  try {
    if (app.get(ConfigService).get('NODE_ENV') === 'production') {
      throw new Error('The audit CLI is disabled in production.');
    }

    const result = await app.get(AuditService).verify(id.toLowerCase());

    process.stdout.write(`${JSON.stringify({ auctionId: id.toLowerCase(), ...result })}\n`);
    process.exitCode =
      result.integrity === 'VERIFIED' ? 0 : result.integrity === 'TAMPERED' ? 2 : 3;
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  process.stderr.write(
    'Audit verification failed. Check the UUID, environment and database availability. Production use is disabled.\n',
  );
  process.exitCode = 1;
});
