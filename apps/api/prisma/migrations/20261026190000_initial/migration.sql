BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('BIDDER', 'AUCTIONEER');

-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('DEPOSIT', 'RESERVE', 'RELEASE', 'PURCHASE', 'SALE');

-- CreateEnum
CREATE TYPE "AuctionLifecycle" AS ENUM ('OPEN', 'CANCELLED', 'ENDED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('NOT_DUE', 'PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('PENDING', 'COMPLETED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'BIDDER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "refreshTokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "rotationVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "userId" UUID NOT NULL,
    "totalCents" BIGINT NOT NULL DEFAULT 0,
    "reservedCents" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "WalletEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" "WalletEntryType" NOT NULL,
    "totalDeltaCents" BIGINT NOT NULL,
    "reservedDeltaCents" BIGINT NOT NULL,
    "reference" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(32) NOT NULL DEFAULT 'TCGDEX',
    "externalId" VARCHAR(128) NOT NULL,
    "language" VARCHAR(10) NOT NULL,
    "title" VARCHAR(256) NOT NULL,
    "description" TEXT,
    "setId" VARCHAR(128) NOT NULL,
    "setName" VARCHAR(256) NOT NULL,
    "cardNumber" VARCHAR(32) NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CatalogSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bytes" BYTEA NOT NULL,
    "mimeType" VARCHAR(32) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sellerId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "imageId" UUID NOT NULL,
    "startingPriceCents" BIGINT NOT NULL,
    "minimumIncrementCents" BIGINT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "originalEndsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "lifecycle" "AuctionLifecycle" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "currentBidId" UUID,
    "bidCount" INTEGER NOT NULL DEFAULT 0,
    "auditHead" CHAR(64) NOT NULL,
    "auditMac" CHAR(64) NOT NULL,
    "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'NOT_DUE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auctionId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAtAfter" TIMESTAMPTZ(3) NOT NULL,
    "pseudonym" VARCHAR(64) NOT NULL,
    "previousHash" CHAR(64) NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "mac" CHAR(64) NOT NULL,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auctionId" UUID NOT NULL,
    "bidId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auctionId" UUID NOT NULL,
    "winningBidId" UUID,
    "amountCents" BIGINT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMPTZ(3),
    "failureCode" VARCHAR(64),

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "publicCode" VARCHAR(64) NOT NULL,
    "auctionId" UUID NOT NULL,
    "itemSnapshot" JSONB NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "winnerPseudonym" VARCHAR(64) NOT NULL,
    "finalHash" CHAR(64) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "state" "IdempotencyState" NOT NULL DEFAULT 'PENDING',
    "resourceId" UUID,
    "response" JSONB,
    "responseStatus" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "WalletEntry_userId_createdAt_id_idx" ON "WalletEntry"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WalletEntry_userId_type_reference_key" ON "WalletEntry"("userId", "type", "reference");

-- CreateIndex
CREATE INDEX "CatalogSnapshot_provider_externalId_language_idx" ON "CatalogSnapshot"("provider", "externalId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_sha256_key" ON "MediaAsset"("sha256");

-- CreateIndex
CREATE INDEX "Auction_lifecycle_endsAt_idx" ON "Auction"("lifecycle", "endsAt");

-- CreateIndex
CREATE INDEX "Auction_sellerId_createdAt_id_idx" ON "Auction"("sellerId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Auction_id_currentBidId_key" ON "Auction"("id", "currentBidId");

-- CreateIndex
CREATE INDEX "Bid_bidderId_acceptedAt_id_idx" ON "Bid"("bidderId", "acceptedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_auctionId_sequence_key" ON "Bid"("auctionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_auctionId_id_key" ON "Bid"("auctionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_auctionId_id_bidderId_key" ON "Bid"("auctionId", "id", "bidderId");

-- CreateIndex
CREATE INDEX "Reservation_userId_status_idx" ON "Reservation"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_auctionId_bidId_userId_key" ON "Reservation"("auctionId", "bidId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_auctionId_key" ON "Settlement"("auctionId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_auctionId_winningBidId_key" ON "Settlement"("auctionId", "winningBidId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_publicCode_key" ON "Receipt"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_auctionId_key" ON "Receipt"("auctionId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_operation_key_key" ON "IdempotencyRecord"("userId", "operation", "key");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Wallet"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "CatalogSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_id_currentBidId_fkey" FOREIGN KEY ("id", "currentBidId") REFERENCES "Bid"("auctionId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_auctionId_bidId_userId_fkey" FOREIGN KEY ("auctionId", "bidId", "userId") REFERENCES "Bid"("auctionId", "id", "bidderId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_auctionId_winningBidId_fkey" FOREIGN KEY ("auctionId", "winningBidId") REFERENCES "Bid"("auctionId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express CHECK constraints or partial unique indexes in this schema.
-- Keep these invariants in versioned SQL; do not replace migrations with db push.
ALTER TABLE "User" ADD CONSTRAINT "User_email_normalized"
  CHECK ("email" = lower(btrim("email")) AND length("email") > 0);
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_valid"
  CHECK ("rotationVersion" >= 0 AND "expiresAt" > "createdAt"
    AND "refreshTokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_balances_valid"
  CHECK (0 <= "reservedCents" AND "reservedCents" <= "totalCents"
    AND "totalCents" <= 100000000000 AND "version" >= 0);
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_deltas_valid"
  CHECK ("totalDeltaCents" BETWEEN -100000000000 AND 100000000000
    AND "reservedDeltaCents" BETWEEN -100000000000 AND 100000000000
    AND CASE "type"
      WHEN 'DEPOSIT' THEN "totalDeltaCents" > 0 AND "reservedDeltaCents" = 0
      WHEN 'RESERVE' THEN "totalDeltaCents" = 0 AND "reservedDeltaCents" > 0
      WHEN 'RELEASE' THEN "totalDeltaCents" = 0 AND "reservedDeltaCents" < 0
      WHEN 'PURCHASE' THEN "totalDeltaCents" < 0 AND "reservedDeltaCents" = "totalDeltaCents"
      WHEN 'SALE' THEN "totalDeltaCents" > 0 AND "reservedDeltaCents" = 0
    END);
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_valid"
  CHECK ("size" BETWEEN 1 AND 2097152 AND "size" = octet_length("bytes")
    AND "mimeType" IN ('image/png', 'image/jpeg', 'image/webp') AND "sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "CatalogSnapshot" ADD CONSTRAINT "CatalogSnapshot_attributes_object"
  CHECK (jsonb_typeof("attributes") = 'object');
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_values_valid"
  CHECK ("startingPriceCents" BETWEEN 1 AND 100000000000
    AND "minimumIncrementCents" BETWEEN 1 AND 100000000000
    AND "startsAt" < "originalEndsAt" AND "originalEndsAt" <= "endsAt"
    AND "version" >= 0 AND "bidCount" >= 0
    AND (("bidCount" = 0 AND "currentBidId" IS NULL) OR ("bidCount" > 0 AND "currentBidId" IS NOT NULL))
    AND ("lifecycle" <> 'CANCELLED' OR "bidCount" = 0)
    AND "auditHead" ~ '^[0-9a-f]{64}$' AND "auditMac" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_values_valid"
  CHECK ("sequence" > 0 AND "amountCents" BETWEEN 1 AND 100000000000
    AND "acceptedAt" < "endsAtAfter" AND length("pseudonym") > 0
    AND "previousHash" ~ '^[0-9a-f]{64}$' AND "hash" ~ '^[0-9a-f]{64}$' AND "mac" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_amount_valid"
  CHECK ("amountCents" BETWEEN 1 AND 100000000000);
CREATE UNIQUE INDEX "Reservation_one_active_per_auction" ON "Reservation" ("auctionId") WHERE "status" = 'ACTIVE';
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_values_valid"
  CHECK ("status" <> 'NOT_DUE' AND "amountCents" BETWEEN 0 AND 100000000000
    AND (("winningBidId" IS NULL AND "amountCents" = 0) OR ("winningBidId" IS NOT NULL AND "amountCents" > 0))
    AND (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL)));
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_values_valid"
  CHECK ("amountCents" BETWEEN 1 AND 100000000000 AND length("publicCode") >= 16
    AND length("winnerPseudonym") > 0 AND jsonb_typeof("itemSnapshot") = 'object'
    AND "finalHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_valid"
  CHECK (length("operation") > 0 AND length("key") > 0 AND "requestHash" ~ '^[0-9a-f]{64}$'
    AND ("responseStatus" IS NULL OR "responseStatus" BETWEEN 200 AND 299)
    AND ("state" <> 'COMPLETED' OR ("response" IS NOT NULL AND "responseStatus" IS NOT NULL)));

COMMIT;
