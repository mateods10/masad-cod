import type { CartSession, TrackingPixel } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildMetaPurchasePayload, buildTikTokPurchasePayload } from "./conversion-api.server";

const input = {
  shop: "demo.myshopify.com",
  orderId: "gid://shopify/Order/10",
  orderName: "#1010",
  cart: {
    fullName: "Andrea España",
    phoneNormalized: "+593998483960",
    email: "Andrea@Example.com",
    city: "Quito",
    province: "Pichincha",
  } as CartSession,
  lines: [{ variantId: "gid://shopify/ProductVariant/123", quantity: 2, unitPrice: 15, title: "Producto", variantTitle: "Default", properties: [] }],
  total: 32.5,
  pageUrl: "https://demo.myshopify.com/products/test?fbclid=abc&ttclid=xyz",
  context: { clientIp: "8.8.8.8", userAgent: "Vitest", cookieHeader: "_fbp=fb.1.123; _ttp=tiktok-cookie" },
};

describe("Conversions API payloads", () => {
  it("hashes customer data and builds a Meta Purchase", () => {
    const payload = buildMetaPurchasePayload(input, { testEventCode: "TEST123" } as TrackingPixel) as any;
    expect(payload.data[0].event_name).toBe("Purchase");
    expect(payload.data[0].custom_data.value).toBe(32.5);
    expect(payload.data[0].user_data.em[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(payload)).not.toContain("Andrea@Example.com");
    expect(payload.test_event_code).toBe("TEST123");
  });

  it("builds a TikTok Purchase without raw PII", () => {
    const payload = buildTikTokPurchasePayload(input, { testEventCode: null } as TrackingPixel) as any;
    expect(payload.data[0].event).toBe("Purchase");
    expect(payload.data[0].properties.contents[0].content_id).toBe("123");
    expect(payload.data[0].user.ttclid).toBe("xyz");
    expect(payload.data[0].user.email).toHaveLength(1);
    expect(payload.data[0].user.phone).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("0998483960");
  });

  it("uses the captured first-touch URL and ttclid", () => {
    const attributedInput = {
      ...input,
      cart: {
        ...input.cart,
        attributionJson: JSON.stringify({
          full_url: "https://demo.myshopify.com/products/test?utm_source=tiktok&ttclid=first-click",
          ttclid: "first-click",
        }),
      } as CartSession,
      pageUrl: "https://demo.myshopify.com/cart?ttclid=later-click",
    };
    const payload = buildTikTokPurchasePayload(attributedInput, { testEventCode: null } as TrackingPixel) as any;
    expect(payload.data[0].page.url).toContain("utm_source=tiktok");
    expect(payload.data[0].user.ttclid).toBe("first-click");
  });
});
