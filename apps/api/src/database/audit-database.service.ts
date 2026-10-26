import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/audit/client';
import type { ApiEnvironment } from '../config/environment';
import { postgresOptions } from './postgres-options';

@Injectable()
export class AuditDatabaseService implements OnApplicationShutdown {
  readonly client: PrismaClient;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.client = new PrismaClient({
      adapter: new PrismaPg(postgresOptions(config.get('AUDIT_DATABASE_URL', { infer: true }))),
      log: [],
    });
  }

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
