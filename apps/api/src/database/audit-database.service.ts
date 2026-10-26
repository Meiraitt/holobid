import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/audit/client';
import type { ApiEnvironment } from '../config/environment';
import { postgresOptions } from './postgres-options';

export type AuditTransactionContext = Prisma.TransactionClient;

@Injectable()
export class AuditDatabaseService implements OnApplicationShutdown {
  readonly client: PrismaClient;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.client = new PrismaClient({
      adapter: new PrismaPg(postgresOptions(config.get('AUDIT_DATABASE_URL', { infer: true }))),
      log: [],
    });
  }

  transaction<T>(work: (tx: AuditTransactionContext) => Promise<T>): Promise<T> {
    return this.client.$transaction(work, { maxWait: 5_000, timeout: 10_000 });
  }

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
