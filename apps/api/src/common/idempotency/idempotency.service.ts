import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService, TransactionContext } from '../../database/database.service';
import type { Prisma } from '../../generated/main/client';
import { ApiException } from '../http/api.exception';
import { canonicalJson, Json } from '../canonical-json';

export type IdempotencyInput = { userId: string; operation: string; key: string; request: Json };
export type OperationResult<T> = { status: number; body: T; resourceId?: string };

@Injectable()
export class IdempotencyService {
  constructor(private readonly database: DatabaseService) {}
  fingerprint(request: Json) { return createHash('sha256').update(canonicalJson(request)).digest('hex'); }
  private scope(input: IdempotencyInput) { return { userId: input.userId, operation: input.operation, key: input.key }; }
  private checkHash(hash: string, input: IdempotencyInput) {
    if (hash !== this.fingerprint(input.request)) throw new ApiException(409, 'IDEMPOTENCY_KEY_REUSED', 'This key was used with a different request.');
  }
  async find<T extends Prisma.InputJsonObject>(input: IdempotencyInput): Promise<OperationResult<T> | null> {
    const record = await this.database.client.idempotencyRecord.findUnique({ where: { userId_operation_key: this.scope(input) } });
    if (!record) return null;
    this.checkHash(record.requestHash, input);
    if (record.state !== 'COMPLETED') throw new ApiException(409, 'OPERATION_PENDING', 'The operation is pending.');
    return { status: record.responseStatus!, body: record.response as T, ...(record.resourceId ? { resourceId: record.resourceId } : {}) };
  }
  execute<T extends Prisma.InputJsonObject>(input: IdempotencyInput, work: (tx: TransactionContext) => Promise<OperationResult<T>>) {
    return this.database.transaction(tx => this.inTransaction(tx, input, work));
  }
  async inTransaction<T extends Prisma.InputJsonObject>(tx: TransactionContext, input: IdempotencyInput,
    work: (tx: TransactionContext) => Promise<OperationResult<T>>, recordId: string = randomUUID()): Promise<OperationResult<T>> {
    const requestHash = this.fingerprint(input.request);
    await tx.$executeRaw`INSERT INTO "IdempotencyRecord" ("id", "userId", "operation", "key", "requestHash")
      VALUES (${recordId}::uuid, ${input.userId}::uuid, ${input.operation}, ${input.key}, ${requestHash})
      ON CONFLICT ("userId", "operation", "key") DO NOTHING`;
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord"
      WHERE "userId" = ${input.userId}::uuid AND "operation" = ${input.operation} AND "key" = ${input.key} FOR UPDATE`;
    const record = await tx.idempotencyRecord.findUniqueOrThrow({ where: { userId_operation_key: this.scope(input) } });
    this.checkHash(record.requestHash, input);
    if (record.state === 'COMPLETED') return { status: record.responseStatus!, body: record.response as T, ...(record.resourceId ? { resourceId: record.resourceId } : {}) };
    const result = await work(tx);
    await tx.idempotencyRecord.update({ where: { id: record.id }, data: { state: 'COMPLETED', response: result.body, responseStatus: result.status, resourceId: result.resourceId } });
    return result;
  }
}
