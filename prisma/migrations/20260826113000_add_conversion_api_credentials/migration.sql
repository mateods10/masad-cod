ALTER TABLE "TrackingPixel" ADD COLUMN "apiToken" TEXT;
ALTER TABLE "TrackingPixel" ADD COLUMN "testEventCode" TEXT;
ALTER TABLE "TrackingPixel" ADD COLUMN "lastSentAt" DATETIME;
ALTER TABLE "TrackingPixel" ADD COLUMN "lastError" TEXT;
