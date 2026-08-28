-- CreateTable
CREATE TABLE "TrackingPixel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pixelId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "viewContent" BOOLEAN NOT NULL DEFAULT true,
    "addToCart" BOOLEAN NOT NULL DEFAULT true,
    "initiateCheckout" BOOLEAN NOT NULL DEFAULT true,
    "addPaymentInfo" BOOLEAN NOT NULL DEFAULT true,
    "purchase" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackingPixel_shop_platform_pixelId_key" ON "TrackingPixel"("shop", "platform", "pixelId");

-- CreateIndex
CREATE INDEX "TrackingPixel_shop_active_idx" ON "TrackingPixel"("shop", "active");
