ALTER TABLE "AppConfig" ADD COLUMN "pancakeEndpoint" TEXT;
ALTER TABLE "AppConfig" ADD COLUMN "pancakePageId" TEXT;
ALTER TABLE "AppConfig" ADD COLUMN "pancakeAccessToken" TEXT;
ALTER TABLE "AppConfig" ADD COLUMN "pancakeTemplateName" TEXT;
ALTER TABLE "AppConfig" ADD COLUMN "pancakeTemplateLang" TEXT NOT NULL DEFAULT 'es';
