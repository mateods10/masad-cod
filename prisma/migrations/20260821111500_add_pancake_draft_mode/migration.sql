ALTER TABLE "AppConfig" ADD COLUMN "pancakeDraftMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CartSession" ADD COLUMN "draftOrderId" TEXT;
ALTER TABLE "CartSession" ADD COLUMN "draftOrderName" TEXT;
ALTER TABLE "CartSession" ADD COLUMN "draftedAt" DATETIME;
