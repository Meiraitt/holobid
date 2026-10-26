ALTER TABLE "Auction" ADD COLUMN "auditKeyId" VARCHAR(32) NOT NULL DEFAULT 'v1',
  ADD COLUMN "auditVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_audit_metadata_valid"
  CHECK ("auditVersion" > 0 AND "auditKeyId" ~ '^[A-Za-z0-9_-]{1,32}$');
