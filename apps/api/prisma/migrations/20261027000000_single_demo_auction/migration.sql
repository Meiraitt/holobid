-- At most one renewable demo auction can remain OPEN, including during recovery.
CREATE UNIQUE INDEX "Auction_one_open_demo" ON "Auction" ("isDemo")
WHERE "isDemo" = true AND "lifecycle" = 'OPEN';
