ALTER TABLE "CartSession" ADD COLUMN "upsellEditing" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "UpsellAcceptance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "orderTotal" DECIMAL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "UpsellAcceptance_shop_orderId_campaignId_offerId_key" ON "UpsellAcceptance"("shop", "orderId", "campaignId", "offerId");
CREATE INDEX "UpsellAcceptance_shop_orderId_status_idx" ON "UpsellAcceptance"("shop", "orderId", "status");
