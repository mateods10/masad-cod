import type { CartSession } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildShopifyShippingAddress, createAbandonedDraftOrder } from "./cart.server";

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
