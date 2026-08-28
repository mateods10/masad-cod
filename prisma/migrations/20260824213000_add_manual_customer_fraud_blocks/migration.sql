CREATE TABLE "CustomerFraudBlock" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "phoneNormalized" TEXT NOT NULL,
  "customerName" TEXT,
  "reason" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "CustomerFraudBlock_shop_phoneNormalized_key" ON "CustomerFraudBlock"("shop", "phoneNormalized");
CREATE INDEX "CustomerFraudBlock_shop_active_createdAt_idx" ON "CustomerFraudBlock"("shop", "active", "createdAt");
