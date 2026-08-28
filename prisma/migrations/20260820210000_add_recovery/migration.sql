-- CreateTable
CREATE TABLE "AppConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Guayaquil',
    "delayHours" INTEGER NOT NULL DEFAULT 12,
    "sendStartHour" INTEGER NOT NULL DEFAULT 8,
    "sendEndHour" INTEGER NOT NULL DEFAULT 21,
    "priorityFee" DECIMAL NOT NULL DEFAULT 2.50,
    "riskMaxQuantity" INTEGER NOT NULL DEFAULT 5,
    "riskMaxOrderValue" DECIMAL NOT NULL DEFAULT 80,
    "sectorFieldEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pancakeMode" TEXT NOT NULL DEFAULT 'mock',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CartSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "browserSessionId" TEXT NOT NULL,
    "recoveryToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "fullName" TEXT,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "email" TEXT,
    "province" TEXT,
    "city" TEXT,
    "sector" TEXT,
    "address" TEXT,
    "reference" TEXT,
    "consentWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" DATETIME,
    "shippingMethod" TEXT NOT NULL DEFAULT 'FREE',
    "paymentMethod" TEXT NOT NULL DEFAULT 'COD',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL NOT NULL DEFAULT 0,
    "linesJson" TEXT NOT NULL DEFAULT '[]',
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskReasonsJson" TEXT NOT NULL DEFAULT '[]',
    "riskZoneMatch" TEXT,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendAt" DATETIME,
    "messageSentAt" DATETIME,
    "clickedAt" DATETIME,
    "recoveredAt" DATETIME,
    "orderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MessageAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cartSessionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'PANCAKE',
    "status" TEXT NOT NULL,
    "providerId" TEXT,
    "error" TEXT,
    "responseJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageAttempt_cartSessionId_fkey" FOREIGN KEY ("cartSessionId") REFERENCES "CartSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CoverageRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "normalizedProvince" TEXT NOT NULL,
    "normalizedCity" TEXT NOT NULL,
    "coverageType" TEXT NOT NULL,
    "deliveryDays" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'EXCEL_2026_02',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RiskZone" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "normalizedProvince" TEXT NOT NULL,
    "normalizedCity" TEXT NOT NULL,
    "normalizedSector" TEXT NOT NULL,
    "observation" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'EXCEL_2026_02',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AppConfig_shop_key" ON "AppConfig"("shop");
CREATE UNIQUE INDEX "CartSession_recoveryToken_key" ON "CartSession"("recoveryToken");
CREATE UNIQUE INDEX "CartSession_shop_browserSessionId_key" ON "CartSession"("shop", "browserSessionId");
CREATE INDEX "CartSession_shop_status_sendAt_idx" ON "CartSession"("shop", "status", "sendAt");
CREATE INDEX "CartSession_shop_phoneNormalized_idx" ON "CartSession"("shop", "phoneNormalized");
CREATE INDEX "MessageAttempt_cartSessionId_createdAt_idx" ON "MessageAttempt"("cartSessionId", "createdAt");
CREATE UNIQUE INDEX "CoverageRule_shop_normalizedProvince_normalizedCity_key" ON "CoverageRule"("shop", "normalizedProvince", "normalizedCity");
CREATE INDEX "CoverageRule_shop_normalizedProvince_idx" ON "CoverageRule"("shop", "normalizedProvince");
CREATE UNIQUE INDEX "RiskZone_shop_normalizedProvince_normalizedCity_normalizedSector_key" ON "RiskZone"("shop", "normalizedProvince", "normalizedCity", "normalizedSector");
CREATE INDEX "RiskZone_shop_normalizedProvince_normalizedCity_active_idx" ON "RiskZone"("shop", "normalizedProvince", "normalizedCity", "active");
