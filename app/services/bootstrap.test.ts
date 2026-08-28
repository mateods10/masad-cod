import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../db.server";
import { ensureShopData } from "./bootstrap.server";

const shop = "global-aura-test.myshopify.com";

beforeAll(async () => {
  await db.riskZone.deleteMany({ where: { shop } });
  await db.coverageRule.deleteMany({ where: { shop } });
  await db.appConfig.deleteMany({ where: { shop } });
});

afterAll(async () => {
  await db.riskZone.deleteMany({ where: { shop } });
  await db.coverageRule.deleteMany({ where: { shop } });
  await db.appConfig.deleteMany({ where: { shop } });
  await db.$disconnect();
});

describe("shop bootstrap", () => {
  it("loads the deduplicated Ecuador coverage and risk data", async () => {
    const config = await ensureShopData(shop);
    const [coverage, risks] = await Promise.all([
      db.coverageRule.count({ where: { shop } }),
      db.riskZone.count({ where: { shop } }),
    ]);
    expect(config.delayHours).toBe(12);
    expect(config.pancakeDraftMode).toBe(false);
    expect(coverage).toBe(435);
    expect(risks).toBe(370);
  });
});
