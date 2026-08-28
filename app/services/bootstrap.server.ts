import coverageData from "../data/coverage.json";
import riskZoneData from "../data/risk-zones.json";
import db from "../db.server";
import { normalizeText } from "../lib/domain";

export async function ensureShopData(shop: string) {
  const config = await db.appConfig.upsert({
    where: { shop },
    update: {},
    create: { shop, pancakeMode: process.env.PANCAKE_MODE === "api" ? "api" : "mock" },
  });

  const [coverageCount, riskCount] = await Promise.all([
    db.coverageRule.count({ where: { shop } }),
    db.riskZone.count({ where: { shop } }),
  ]);

  if (coverageCount === 0) {
    const rows = coverageData.map((row) => ({
        shop,
        province: row.province,
        city: row.destination,
        normalizedProvince: normalizeText(row.province),
        normalizedCity: normalizeText(row.destination),
        coverageType: row.coverageType,
        deliveryDays: row.deliveryDays,
      }));
    for (let index = 0; index < rows.length; index += 75) {
      await db.coverageRule.createMany({ data: rows.slice(index, index + 75) });
    }
  }

  if (riskCount === 0) {
    const rows = riskZoneData.map((row) => ({
        shop,
        province: row.province,
        city: row.destination,
        sector: row.sector,
        normalizedProvince: normalizeText(row.province),
        normalizedCity: normalizeText(row.destination),
        normalizedSector: normalizeText(row.sector),
        observation: row.observation,
      }));
    for (let index = 0; index < rows.length; index += 60) {
      await db.riskZone.createMany({ data: rows.slice(index, index + 60) });
    }
  }

  return config;
}
