import { describe, expect, it } from "vitest";

import { attributionOrderAttributes, mergeAttribution, sanitizeAttribution } from "./attribution.server";

describe("TikTok marketing attribution", () => {
  it("keeps first-touch campaign values and refreshes the cart token", () => {
    const first = sanitizeAttribution({
      utm_source: "tiktok",
      utm_campaign: "Campaña inicial",
      ttclid: "click-123",
      full_url: "https://demo.myshopify.com/products/test?utm_source=tiktok",
      ignored: "not stored",
    });
    const merged = mergeAttribution(first, sanitizeAttribution({
      utm_campaign: "Campaña posterior",
      "shopify-cart-token": "cart-456",
    }));
    expect(merged.utm_campaign).toBe("Campaña inicial");
    expect(merged["shopify-cart-token"]).toBe("cart-456");
    expect(merged).not.toHaveProperty("ignored");
  });

  it("turns saved attribution into visible Shopify order attributes", () => {
    const attributes = attributionOrderAttributes(JSON.stringify({
      utm_source: "tiktok",
      tt_campaignid: "campaign-1",
      tt_adgroupid: "adgroup-2",
      tt_creativeid: "creative-3",
    }));
    expect(attributes).toContainEqual({ key: "utm_source", value: "tiktok" });
    expect(attributes).toContainEqual({ key: "tt_creativeid", value: "creative-3" });
  });
});
