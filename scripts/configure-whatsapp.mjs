// Run within the selected service. No secrets or customer records are printed.
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
try {
  const [shop, phone, storeName, apply] = process.argv.slice(2);
  if (!shop) {
    const stores = await db.appConfig.findMany({ select: { shop: true } });
    console.log(JSON.stringify(stores));
  } else {
    const config = await db.appConfig.findUniqueOrThrow({ where: { shop } });
    const settings = JSON.parse(config.integrationsJson || '{}');
    if (apply === '--apply') {
      if (!/^\+5939\d{8}$/.test(phone) || !storeName?.trim()) throw new Error('Valid Ecuador phone and store name required');
      await db.appConfig.update({ where: { shop }, data: { integrationsJson: JSON.stringify({ ...settings, whatsappConfirmationEnabled: true, whatsappPhone: phone, whatsappStoreName: storeName.trim() }) } });
    }
    const saved = JSON.parse((await db.appConfig.findUniqueOrThrow({ where: { shop } })).integrationsJson);
    console.log(JSON.stringify({ shop, enabled: saved.whatsappConfirmationEnabled, phone: saved.whatsappPhone, storeName: saved.whatsappStoreName }));
  }
} finally { await db.$disconnect(); }
