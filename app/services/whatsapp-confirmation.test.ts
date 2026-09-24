import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("../db.server", () => ({ default: { cartSession: { findFirst: mocks.find } } }));
import { buildConfirmationMessage, confirmationToken, getWhatsappConfirmation, verifyConfirmationToken, type ConfirmationOrder } from "./whatsapp-confirmation.server";
import { normalizeEcuadorPhone } from "../lib/domain";
const settings = JSON.stringify({ whatsappConfirmationEnabled: true, whatsappPhone: "0984578367", whatsappStoreName: "Luminos" });
const order: ConfirmationOrder = { id: "gid://shopify/Order/1", name: "#1001", cancelledAt: null, currentTotalPriceSet: { shopMoney: { amount: "52.49", currencyCode: "USD" } }, lineItems: { nodes: [{ title: "Crema", variantTitle: "50 ml", currentQuantity: 1 }, { title: "Oferta adicional", variantTitle: "Default Title", currentQuantity: 2 }, { title: "Eliminado", variantTitle: null, currentQuantity: 0 }], pageInfo: { hasNextPage: false } }, shippingAddress: { name: "Cliente de prueba", address1: "Calle de prueba", address2: "Casa de prueba", city: "Quito", province: "Pichincha", phone: "0999999999" }, shippingLines: { nodes: [{ title: "Envío prioritario" }] } };
beforeEach(() => { vi.resetAllMocks(); vi.useRealTimers(); vi.stubEnv("SHOPIFY_API_SECRET", "test-only"); mocks.find.mockResolvedValue({ orderId: order.id, phoneNormalized: "+593999999999" }); });
describe("WhatsApp confirmation", () => {
  it("signs short-lived order-specific tokens isolated between stores", () => {
    const token = confirmationToken("luminos", "cart1");
    expect(verifyConfirmationToken("luminos", token)).toBe("cart1");
    expect(() => verifyConfirmationToken("global", token)).toThrow();
    expect(() => verifyConfirmationToken("luminos", token + "x")).toThrow();
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 61 * 60_000);
    expect(() => verifyConfirmationToken("luminos", token)).toThrow("venció");
  });
  it("uses final quantities, total, currency, shipping and full address", () => {
    const text = buildConfirmationMessage("Luminos", order, "+593999999999");
    for (const value of ["Luminos", "#1001", "1 × Crema · 50 ml", "2 × Oferta adicional", "52,49", "USD", "Envío prioritario", "Quito, Pichincha", "Casa de prueba"]) expect(text).toContain(value);
    expect(text).not.toContain("Default Title"); expect(text).not.toContain("Eliminado");
  });
  it("only reads a consenting completed order and returns a link, never sends", async () => {
    const admin = { graphql: vi.fn().mockResolvedValue(Response.json({ data: { order } })) };
    const result = await getWhatsappConfirmation("luminos", admin, settings, confirmationToken("luminos", "cart1"));
    expect(result.url).toMatch(/^https:\/\/wa.me\/593984578367\?text=/);
    expect(mocks.find).toHaveBeenCalledWith({ where: { id: "cart1", shop: "luminos", status: "ORDERED", consentWhatsapp: true } });
    expect(admin.graphql).toHaveBeenCalledTimes(1);
    expect(admin.graphql.mock.calls[0][0]).not.toContain("mutation");
  });
  it("does not query disabled stores or disclose another store's order", async () => {
    const admin = { graphql: vi.fn() };
    expect(await getWhatsappConfirmation("global", admin, "{}", "")).toEqual({ enabled: false });
    await expect(getWhatsappConfirmation("global", admin, settings, confirmationToken("luminos", "cart1"))).rejects.toThrow();
    expect(admin.graphql).not.toHaveBeenCalled();
  });
  it("refuses an uncertain upsell total and missing completed order", async () => {
    const admin = { graphql: vi.fn() };
    mocks.find.mockResolvedValueOnce({ orderId: order.id, upsellEditing: true });
    await expect(getWhatsappConfirmation("luminos", admin, settings, confirmationToken("luminos", "cart1"))).rejects.toThrow("total final");
    mocks.find.mockResolvedValueOnce(null);
    await expect(getWhatsappConfirmation("luminos", admin, settings, confirmationToken("luminos", "cart1"))).rejects.toThrow("No se encontró");
    expect(admin.graphql).not.toHaveBeenCalled();
  });
  it("normalizes local phones but rejects foreign prefixes and letters", () => {
    for (const value of ["0984578367", "+593 98 457 8367", "984578367"]) expect(normalizeEcuadorPhone(value)).toBe("+593984578367");
    for (const value of ["+57 315 0032206", "abc0984578367", "+0984578367", "123"]) expect(normalizeEcuadorPhone(value)).toBeNull();
  });
});
