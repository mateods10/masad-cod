import { describe, expect, it } from "vitest";
import {
  evaluateRisk,
  findRiskZoneMatch,
  hasEnoughInventory,
  isInsideSendWindow,
  nextAllowedSendAt,
  normalizeEcuadorPhone,
  normalizeText,
  sanitizeLineProperties,
} from "./domain";

describe("inventory rules", () => {
  it("allows products whose inventory is not tracked", () => {
    expect(hasEnoughInventory({ tracked: false, policy: "DENY", available: 0, requested: 1 })).toBe(true);
  });

  it("blocks a tracked product when the requested quantity exceeds stock", () => {
    expect(hasEnoughInventory({ tracked: true, policy: "DENY", available: 0, requested: 1 })).toBe(false);
  });

  it("allows a tracked product when Shopify permits overselling", () => {
    expect(hasEnoughInventory({ tracked: true, policy: "CONTINUE", available: 0, requested: 1 })).toBe(true);
  });
});

describe("line item properties", () => {
  it("keeps safe pack selections and removes empty values", () => {
    expect(sanitizeLineProperties([
      { name: "  Unidad   1 ", value: " Azul / M " },
      { name: "Unidad 2", value: "" },
    ])).toEqual([{ name: "Unidad 1", value: "Azul / M" }]);
  });
});

describe("normalization", () => {
  it("normalizes Ecuadorian phone numbers", () => {
    expect(normalizeEcuadorPhone("099 539 3511")).toBe("+593995393511");
    expect(normalizeEcuadorPhone("593995393511")).toBe("+593995393511");
    expect(normalizeEcuadorPhone("123")).toBeNull();
  });

  it("removes accents and punctuation", () => {
    expect(normalizeText("Santo Domingo de los Tsáchilas")).toBe("SANTO DOMINGO DE LOS TSACHILAS");
  });
});

describe("recovery schedule", () => {
  it("keeps a due time inside the Ecuador window", () => {
    const activity = new Date("2026-08-20T14:00:00.000Z"); // 09:00 Ecuador
    expect(nextAllowedSendAt(activity).toISOString()).toBe("2026-08-21T02:00:00.000Z");
  });

  it("moves a due time after 21:00 to 08:00", () => {
    const activity = new Date("2026-08-20T14:01:00.000Z"); // due 21:01 Ecuador
    expect(nextAllowedSendAt(activity).toISOString()).toBe("2026-08-21T13:00:00.000Z");
  });

  it("limits only message delivery to the configured Ecuador window", () => {
    expect(isInsideSendWindow(new Date("2026-08-21T12:59:00.000Z"))).toBe(false);
    expect(isInsideSendWindow(new Date("2026-08-21T13:00:00.000Z"))).toBe(true);
    expect(isInsideSendWindow(new Date("2026-08-22T02:00:00.000Z"))).toBe(true);
    expect(isInsideSendWindow(new Date("2026-08-22T02:01:00.000Z"))).toBe(false);
  });
});

describe("risk rules", () => {
  const zones = [{ province: "AZUAY", city: "CUENCA", sector: "Sector Turi" }];

  it("finds a zone in the free-text address", () => {
    expect(findRiskZoneMatch(zones, { province: "Azuay", city: "Cuenca", address: "Turi sector alto" }).type).toBe("POTENTIAL");
    expect(findRiskZoneMatch(zones, { province: "Azuay", city: "Cuenca", sector: "Sector Turi" }).type).toBe("CONFIRMED");
  });

  it("raises quantity and value warnings", () => {
    const result = evaluateRisk({
      lines: [{ variantId: "1", quantity: 6 }],
      subtotal: 81,
      maxQuantity: 5,
      maxOrderValue: 80,
      zoneMatch: "NONE",
    });
    expect(result.score).toBe(50);
    expect(result.level).toBe("HIGH");
  });
});
