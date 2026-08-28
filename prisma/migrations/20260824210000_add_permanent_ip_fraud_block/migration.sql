CREATE TABLE "FraudIpAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "clientIpHash" TEXT NOT NULL,
  "cartSessionId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FraudIpAttempt_cartSessionId_fkey" FOREIGN KEY ("cartSessionId") REFERENCES "CartSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FraudIpAttempt_cartSessionId_key" ON "FraudIpAttempt"("cartSessionId");
CREATE INDEX "FraudIpAttempt_shop_clientIpHash_createdAt_idx" ON "FraudIpAttempt"("shop", "clientIpHash", "createdAt");

CREATE TABLE "FraudIpBlock" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "clientIpHash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 3,
  "blockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "FraudIpBlock_shop_clientIpHash_key" ON "FraudIpBlock"("shop", "clientIpHash");
CREATE INDEX "FraudIpBlock_shop_blockedAt_idx" ON "FraudIpBlock"("shop", "blockedAt");
