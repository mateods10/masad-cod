import type { CartSession } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildShopifyOrderLineItems, buildShopifyOrderNote, buildShopifyShippingAddress, createAbandonedDraftOrder, resolveLines } from "./cart.server";

describe("Shopify and PosCake address", () => {
  it("sends the city and both province representations", () => {
    expect(buildShopifyShippingAddress({
      fullName: "José Jaramillo",
      phone: "+593968438751",
      address: "Rumiñahui camino secundario",
      reference: "Casa verde agua",
      city: "Pedro Moncayo",
      province: "Pichincha",
    })).toEqual({
      firstName: "José",
      lastName: "Jaramillo",
      phone: "+593968438751",
      address1: "Rumiñahui camino secundario",
      address2: "Casa verde agua",
      city: "Pedro Moncayo",
      province: "Pichincha",
      provinceCode: "P",
      countryCode: "EC",
    });
  });

  it("sends city and full province as separate PosCake fields without the one-letter code", () => {
    expect(buildShopifyShippingAddress({
      fullName: "Betsabeth Pérez",
      phone: "+5939999905636",
      address: "Av. Morán Valverde",
      reference: "Centro comercial",
      city: "Quito",
      province: "PICHINCHA",
    }, { fullProvinceForPosCake: true })).toEqual({
      firstName: "Betsabeth",
      lastName: "Pérez",
      phone: "+5939999905636",
      address1: "Av. Morán Valverde",
      address2: "Centro comercial",
      city: "Quito",
      province: "Pichincha",
      countryCode: "EC",
    });
  });
});

describe("Shopify and PosCake shipping workflow", () => {
  it("puts every selected pack unit into the visible line title for the shipping guide", () => {
    expect(buildShopifyOrderLineItems([{
      variantId: "gid://shopify/ProductVariant/123",
      quantity: 1,
      title: "Tank Top",
      variantTitle: "2 Tank Top / Blanco / L/XL",
      offerTitle: "2 Tank Top",
      properties: [
        { name: "Unidad 2", value: "Negro / M" },
        { name: "Opción", value: "2 Tank Top" },
        { name: "Unidad 1", value: "Blanco / L/XL" },
      ],
    }])).toEqual([{
      variantId: "gid://shopify/ProductVariant/123",
      quantity: 1,
      title: "Tank Top — 2 Tank Top — #1: Blanco / L/XL + #2: Negro / M",
      variantTitle: "2 Tank Top",
      properties: [
        { name: "Unidad 2", value: "Negro / M" },
        { name: "Opción", value: "2 Tank Top" },
        { name: "Unidad 1", value: "Blanco / L/XL" },
      ],
      requiresShipping: true,
    }]);
  });

  it.each([1, 2, 3])("retains the selected %i-unit offer for a single-option product", async (count) => {
    const graphql = vi.fn(async () => Response.json({ data: { nodes: [{
      id: "gid://shopify/ProductVariant/123", title: `${count} Shaver 3 en 1`,
      selectedOptions: [{ name: "Oferta", value: `${count} Shaver 3 en 1` }],
      price: "47.99", inventoryQuantity: 10, inventoryPolicy: "DENY",
      inventoryItem: { tracked: true }, product: { title: "Shaver 3 en 1" },
    }] } }));
    const resolved = await resolveLines({ graphql }, [{ variantId: 123, quantity: 1 }]);
    expect(buildShopifyOrderLineItems(resolved)[0]).toMatchObject({
      title: `Shaver 3 en 1 — ${count} Shaver 3 en 1`,
      variantTitle: `${count} Shaver 3 en 1`,
      variantId: "gid://shopify/ProductVariant/123", quantity: 1,
    });
    expect(resolved[0].unitPrice).toBe(47.99);
  });

  it("uses Shopify's pack name and retains all suboptions without trusting the posted offer label", async () => {
    const graphql = vi.fn(async () => Response.json({ data: { nodes: [{
      id: "gid://shopify/ProductVariant/123", title: "2 Tank Top / Blanco / L/XL",
      selectedOptions: [{ name: "Oferta", value: "2 Tank Top" }, { name: "Color", value: "Blanco" }, { name: "Talla", value: "L/XL" }],
      price: "35.99", inventoryQuantity: 10, inventoryPolicy: "DENY",
      inventoryItem: { tracked: true }, product: { title: "Tank Top" },
    }] } }));
    const resolved = await resolveLines({ graphql }, [{ variantId: 123, quantity: 1, properties: [
      { name: "Opción", value: "Oferta incorrecta" },
      { name: "Unidad 1", value: "Blanco / L/XL" },
      { name: "Unidad 2", value: "Negro / S/M" },
    ] }]);
    expect(buildShopifyOrderLineItems(resolved)[0]).toMatchObject({
      title: "Tank Top — 2 Tank Top — #1: Blanco / L/XL + #2: Negro / S/M",
      variantTitle: "2 Tank Top", quantity: 1, variantId: "gid://shopify/ProductVariant/123",
    });
  });

  it("does not print Shopify's Default Title for a product without options", () => {
    expect(buildShopifyOrderLineItems([{ variantId: "gid://shopify/ProductVariant/1", quantity: 1,
      title: "Crema", variantTitle: "Default Title", offerTitle: "Default Title" }])[0]).not.toHaveProperty("title");
  });

  it("marks every completed COD line as requiring physical shipping", () => {
    expect(buildShopifyOrderLineItems([
      {
        variantId: "gid://shopify/ProductVariant/1",
        quantity: 2,
        properties: [{ name: "Opción", value: "Pack 2" }],
      },
    ])).toEqual([
      {
        variantId: "gid://shopify/ProductVariant/1",
        quantity: 2,
        properties: [{ name: "Opción", value: "Pack 2" }],
        requiresShipping: true,
      },
    ]);
  });
});

describe("Shopify order note", () => {
  it("shows a compact marketing summary without technical URLs or cart tokens", () => {
    const note = buildShopifyOrderNote({
      shippingSummary: "Envío gratis",
      reference: "Al lado de la farmacia",
      marketingPlatform: "TIKTOK",
      attribution: {
        utm_source: "tiktok",
        utm_medium: "paid",
        utm_campaign: "Deep Algo",
        full_url: "https://example.com/product?ttclid=very-long-click-id",
        "shopify-cart-token": "private-cart-token",
      },
      isRiskZone: false,
      riskScore: 0,
      riskReasons: [],
    });

    expect(note).toContain("ORIGEN DE LA VENTA\nPlataforma: TikTok");
    expect(note).toContain("Canal: tiktok / paid");
    expect(note).toContain("Campaña: Deep Algo");
    expect(note).not.toContain("https://");
    expect(note).not.toContain("private-cart-token");
  });
});

describe("Pancake draft recovery", () => {
  it("creates a tagged Shopify draft without counting it as a completed order", async () => {
    const graphql = vi.fn(async (_query: string, _options?: { variables?: Record<string, unknown> }) => Response.json({
      data: { draftOrderCreate: { draftOrder: { id: "gid://shopify/DraftOrder/10", name: "#D10" }, userErrors: [] } },
    }));
    const cart = {
      id: "cart-10",
      shop: "luminos-test.myshopify.com",
      recoveryToken: "recover-10",
      fullName: "Andrea España",
      phone: "0995393511",
      phoneNormalized: "+593995393511",
      email: "andrea@example.com",
      province: "PICHINCHA",
      city: "Quito",
      address: "Av. Principal 123",
      reference: "Casa blanca",
      linesJson: JSON.stringify([{ variantId: "gid://shopify/ProductVariant/1", quantity: 2, properties: [] }]),
      draftOrderId: null,
      draftOrderName: null,
    } as CartSession;

    const draft = await createAbandonedDraftOrder({ graphql }, cart);
    expect(draft.name).toBe("#D10");
    const variables = graphql.mock.calls[0]?.[1]?.variables as { input: { tags: string[]; customAttributes: Array<{ key: string; value: string }> } };
    expect(variables.input.tags).toEqual(["MASAD_COD", "CARRITO_ABANDONADO", "PANCAKE_BORRADOR"]);
    expect(variables.input.tags).toContain("CARRITO_ABANDONADO");
    expect(variables.input.customAttributes).toContainEqual({ key: "Estado Masad", value: "BORRADOR" });
    expect(variables.input.customAttributes).toContainEqual({ key: "Provincia", value: "PICHINCHA" });
    expect(variables.input.customAttributes).toContainEqual({ key: "Ciudad", value: "Quito" });
  });
});
