import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService, TransactionContext } from '../../database/database.service';
import type { Prisma } from '../../generated/main/client';
import { ApiException } from '../http/api.exception';

import { canonicalJson, Json } from '../canonical-json';

type OperationResult<T> = { status: number; body: T; resourceId?: string };

@Injectable()
export class IdempotencyService {
  constructor(private readonly database: DatabaseService) {}

  async execute<T extends Prisma.InputJsonObject>(
    input: { userId: string; operation: string; key: string; request: Json },
    work: (tx: TransactionContext) => Promise<OperationResult<T>>,
  ): Promise<OperationResult<T>> {
    const requestHash = createHash('sha256').update(canonicalJson(input.request)).digest('hex');
    return this.database.transaction(async tx => {
      // ON CONFLICT waits for a concurrent owner without aborting this transaction.
      await tx.$executeRaw`INSERT INTO "IdempotencyRecord" ("userId", "operation", "key", "requestHash")
        VALUES (${input.userId}::uuid, ${input.operation}, ${input.key}, ${requestHash})
        ON CONFLICT ("userId", "operation", "key") DO NOTHING`;
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord"
        WHERE "userId" = ${input.userId}::uuid AND "operation" = ${input.operation} AND "key" = ${input.key} FOR UPDATE`;
      const record = await tx.idempotencyRecord.findUniqueOrThrow({
        where: { userId_operation_key: { userId: input.userId, operation: input.operation, key: input.key } },
      });
      if (record.requestHash !== requestHash) throw new ApiException(409, 'IDEMPOTENCY_KEY_REUSED', 'This key was used with a different request.');
      if (record.state === 'COMPLETED') {
        // The only writer is this service; responses are JSON-safe, versioned by operation.
        return { status: record.responseStatus!, body: record.response as T, ...(record.resourceId ? { resourceId: record.resourceId } : {}) };
      }
      const result = await work(tx);
      await tx.idempotencyRecord.update({ where: { id: record.id }, data: {
        state: 'COMPLETED', response: result.body, responseStatus: result.status, resourceId: result.resourceId,
      } });
      return result;
    });
  }
}
