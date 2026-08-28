ALTER TABLE "CartSession" ADD COLUMN "attributionJson" TEXT NOT NULL DEFAULT '{}';
UPDATE "TrackingPixel" SET "testEventCode" = NULL;
