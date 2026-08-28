import { describe, expect, it } from "vitest";

import {
  attributionOrderAttributes,
  detectMarketingPlatform,
  mergeAttribution,
  sanitizeAttribution,
  shopifyReferringSite,
} from "./attribution.server";

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

  it("maps TikTok clicks to a Shopify referrer", () => {
    const value = JSON.stringify({
      full_url: "https://demo.myshopify.com/products/test?ttclid=click-123",
    });
    expect(detectMarketingPlatform(value)).toBe("TIKTOK");
    expect(shopifyReferringSite(value)).toBe("https://www.tiktok.com/");
  });

  it("maps Meta clicks to Facebook or Instagram referrers", () => {
    const facebook = JSON.stringify({
      full_url: "https://demo.myshopify.com/products/test?fbclid=click-456",
    });
    const instagram = JSON.stringify({
      utm_source: "instagram",
      referrer_url: "https://l.instagram.com/",
    });
    expect(detectMarketingPlatform(facebook)).toBe("META");
    expect(shopifyReferringSite(facebook)).toBe("https://www.facebook.com/");
    expect(shopifyReferringSite(instagram)).toBe("https://www.instagram.com/");
  });

  it("keeps a real external referrer for other sources", () => {
    const value = JSON.stringify({ referrer_url: "https://example.com/article" });
    expect(detectMarketingPlatform(value)).toBeNull();
    expect(shopifyReferringSite(value)).toBe("https://example.com/article");
  });
});
