BEGIN;
ALTER TABLE "AuditCheckpoint" ADD COLUMN "keyId" VARCHAR(32) NOT NULL DEFAULT 'v1',
  ADD COLUMN "algorithmVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AuditIntent" ADD COLUMN "keyId" VARCHAR(32) NOT NULL DEFAULT 'v1',
  ADD COLUMN "algorithmVersion" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "proofHash" CHAR(64);
ALTER TABLE "AuditCheckpoint" ADD CONSTRAINT "AuditCheckpoint_metadata_valid"
  CHECK ("algorithmVersion" > 0 AND "keyId" ~ '^[A-Za-z0-9_-]{1,32}$');
ALTER TABLE "AuditIntent" ADD CONSTRAINT "AuditIntent_metadata_valid"
  CHECK ("algorithmVersion" > 0 AND "keyId" ~ '^[A-Za-z0-9_-]{1,32}$'
    AND ("proofHash" IS NULL OR "proofHash" ~ '^[0-9a-f]{64}$'));
COMMIT;
