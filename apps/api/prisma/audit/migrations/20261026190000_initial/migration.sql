BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AuditIntentState" AS ENUM ('PREPARED', 'COMMITTED', 'ABORTED');

-- CreateTable
CREATE TABLE "AuditCheckpoint" (
    "auctionId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "headHash" CHAR(64) NOT NULL,
    "headMac" CHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuditCheckpoint_pkey" PRIMARY KEY ("auctionId")
);

-- CreateTable
CREATE TABLE "AuditIntent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auctionId" UUID NOT NULL,
    "operationKey" UUID NOT NULL,
    "expectedSequence" INTEGER,
    "expectedHeadHash" CHAR(64),
    "nextSequence" INTEGER NOT NULL,
    "nextHeadHash" CHAR(64) NOT NULL,
    "nextHeadMac" CHAR(64) NOT NULL,
    "state" "AuditIntentState" NOT NULL DEFAULT 'PREPARED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AuditIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditIntent_operationKey_key" ON "AuditIntent"("operationKey");

-- CreateIndex
CREATE INDEX "AuditIntent_auctionId_createdAt_idx" ON "AuditIntent"("auctionId", "createdAt");

ALTER TABLE "AuditCheckpoint" ADD CONSTRAINT "AuditCheckpoint_valid"
  CHECK ("sequence" >= 0 AND "version" >= 0
    AND "headHash" ~ '^[0-9a-f]{64}$' AND "headMac" ~ '^[0-9a-f]{64}$');
ALTER TABLE "AuditIntent" ADD CONSTRAINT "AuditIntent_valid"
  CHECK ((("expectedSequence" IS NULL AND "expectedHeadHash" IS NULL AND "nextSequence" = 0)
      OR ("expectedSequence" IS NOT NULL AND "expectedHeadHash" IS NOT NULL
        AND "expectedSequence" >= 0 AND "nextSequence" = "expectedSequence" + 1))
    AND ("expectedHeadHash" IS NULL OR "expectedHeadHash" ~ '^[0-9a-f]{64}$')
    AND "nextHeadHash" ~ '^[0-9a-f]{64}$' AND "nextHeadMac" ~ '^[0-9a-f]{64}$'
    AND (("state" = 'PREPARED') = ("resolvedAt" IS NULL)));
CREATE UNIQUE INDEX "AuditIntent_one_prepared_per_auction" ON "AuditIntent" ("auctionId") WHERE "state" = 'PREPARED';

COMMIT;
