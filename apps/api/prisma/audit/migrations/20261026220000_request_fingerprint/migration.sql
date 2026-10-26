ALTER TABLE "AuditIntent" ADD COLUMN "requestHash" CHAR(64);
ALTER TABLE "AuditIntent" ADD CONSTRAINT "AuditIntent_request_hash_valid"
  CHECK ("requestHash" IS NULL OR "requestHash" ~ '^[0-9a-f]{64}$');
