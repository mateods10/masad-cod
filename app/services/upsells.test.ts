import { describe, expect, it, vi, afterEach } from "vitest";
import {
  matchingOffers,
  offerPrice,
  validateUpsell,
  type UpsellCampaign,
} from "../lib/upsells";
import { canonicalCampaign, quoteUpsells } from "./upsells.server";
import { postUpsellToken, verifyPostToken } from "./post-upsells.server";
const campaign: UpsellCampaign = {
  id: "one",
  name: "Complemento",
  active: true,
  mode: "PRE",
  triggers: [{ id: "gid://shopify/Product/1", title: "Principal", image: "" }],
  offers: [
    {
      id: "offer",
      product: { id: "gid://shopify/Product/2", title: "Extra", image: "" },
      variantId: "gid://shopify/ProductVariant/2",
      variantTitle: "Default Title",
      price: 999,
      discountPercent: 10,
      headline: "Agrega este producto",
    },
  ],
};
const variant = (id: number, price = "20.00", inventory = 10) => ({
  id: `gid://shopify/ProductVariant/${id}`,
  title: "Default Title",
  price,
  inventoryQuantity: inventory,
  inventoryPolicy: "DENY",
  inventoryItem: { tracked: true },
  product: {
    id: `gid://shopify/Product/${id}`,
    title: "Producto",
    status: "ACTIVE",
    featuredImage: null,
  },
});
const admin = (offered = variant(2)) => ({
  graphql: vi.fn(
    async (_: string, options?: { variables?: Record<string, unknown> }) =>
      Response.json({
        data: {
          nodes: (options?.variables?.ids as string[]).map((id) =>
            id.endsWith("/1") ? variant(1) : offered,
          ),
        },
      }),
  ),
});
describe("upsell eligibility and trusted pricing", () => {
  it("only selects the matching stage and trigger, with no self-upsells", () => {
    expect(matchingOffers([campaign], ["gid://shopify/Product/3"])).toEqual([]);
    expect(
      matchingOffers([campaign], ["gid://shopify/Product/1"], "POST"),
    ).toEqual([]);
    expect(
      matchingOffers(
        [campaign],
        ["gid://shopify/Product/1", "gid://shopify/Product/2"],
      ),
    ).toEqual([]);
    expect(
      matchingOffers(
        [{ ...campaign, active: false }],
        ["gid://shopify/Product/1"],
      ),
    ).toEqual([]);
    expect(
      matchingOffers([campaign], ["gid://shopify/Product/1"]),
    ).toHaveLength(1);
  });
  it("caps the full customer sequence at five offers", () => {
    expect(
      matchingOffers(
        Array.from({ length: 8 }, (_, i) => ({ ...campaign, id: String(i) })),
        ["gid://shopify/Product/1"],
      ),
    ).toHaveLength(5);
  });
  it("rejects invalid discounts, missing products and too many offers", () => {
    expect(() => validateUpsell({ ...campaign, triggers: [] })).toThrow();
    expect(() =>
      validateUpsell({
        ...campaign,
        offers: [{ ...campaign.offers[0], discountPercent: -1 }],
      }),
    ).toThrow();
    expect(() =>
      validateUpsell({
        ...campaign,
        offers: Array(6).fill(campaign.offers[0]),
      }),
    ).toThrow();
    expect(validateUpsell({ ...campaign, mode: "POST" }).mode).toBe("POST");
  });
  it("quotes live Shopify prices rather than stored or browser-supplied prices", async () => {
    const offers = await quoteUpsells(
      admin(),
      JSON.stringify({ upsells: [campaign] }),
      [{ variantId: 1 }],
    );
    expect(offers[0].price).toBe(20);
    expect(offers[0].finalPrice).toBe(18);
    expect(offerPrice(29.99, 10)).toBe(26.99);
  });
  it("does not offer sold-out variants", async () => {
    expect(
      await quoteUpsells(
        admin(variant(2, "20", 0)),
        JSON.stringify({ upsells: [campaign] }),
        [{ variantId: 1 }],
      ),
    ).toEqual([]);
  });
  it("rejects variants from a different product", async () => {
    await expect(
      canonicalCampaign(admin(variant(3)), campaign),
    ).rejects.toThrow();
  });
});
describe("post-purchase authorization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
  it("binds the token to the store and cart and rejects tampering", () => {
    vi.stubEnv("SHOPIFY_API_SECRET", "unit-test-secret");
    const token = postUpsellToken("shop-a", "cart-one");
    expect(verifyPostToken("shop-a", token)).toBe("cart-one");
    expect(() => verifyPostToken("shop-b", token)).toThrow();
    expect(() => verifyPostToken("shop-a", token + "x")).toThrow();
  });
  it("expires the permission after fifteen minutes", () => {
    vi.stubEnv("SHOPIFY_API_SECRET", "unit-test-secret");
    vi.useFakeTimers();
    const token = postUpsellToken("shop", "cart");
    vi.advanceTimersByTime(16 * 60_000);
    expect(() => verifyPostToken("shop", token)).toThrow();
  });
});
