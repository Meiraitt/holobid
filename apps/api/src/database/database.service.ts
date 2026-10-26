import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/main/client';
import type { ApiEnvironment } from '../config/environment';
import { postgresOptions } from './postgres-options';

export type TransactionContext = Prisma.TransactionClient;

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly client: PrismaClient;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.client = new PrismaClient({
      adapter: new PrismaPg(postgresOptions(config.get('DATABASE_URL', { infer: true }))),
      log: [],
    });
  }

  // The service owns one transaction and passes it to every participating repository.
  transaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.client.$transaction(work, { maxWait: 5_000, timeout: 10_000 });
  }

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
