import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ cart: vi.fn(), claim: vi.fn(), cartUpdate: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), transaction: vi.fn(), quote: vi.fn() }));
vi.mock("../db.server", () => ({ default: { cartSession: { findFirst: mocks.cart, updateMany: mocks.claim, update: mocks.cartUpdate }, upsellAcceptance: { findUnique: mocks.find, create: mocks.create, update: mocks.update, delete: mocks.remove }, $transaction: mocks.transaction } }));
vi.mock("./upsells.server", () => ({ quoteUpsells: mocks.quote }));
import { acceptPostUpsell, postUpsellToken } from "./post-upsells.server";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SHOPIFY_API_SECRET", "test-only");
  mocks.cart.mockResolvedValue({ id: "cart", orderId: "gid://shopify/Order/1", status: "ORDERED", recoveredAt: new Date(), linesJson: "[]" });
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.create.mockResolvedValue({ id: "acceptance" });
  mocks.quote.mockResolvedValue([{ id: "offer", campaignId: "campaign", variantId: "gid://shopify/ProductVariant/2", finalPrice: 18, discountPercent: 10, product: { title: "Extra" }, headline: "Oferta" }]);
});
const input = () => ({ token: postUpsellToken("shop", "cart"), campaignId: "campaign", offerId: "offer", expectedPrice: 18 });
const client = (commitFails = false) => ({ graphql: vi.fn(async (query: string) => {
  if (query.includes("MasadUpsellBegin")) return Response.json({ data: { orderEditBegin: { calculatedOrder: { id: "edit" }, userErrors: [] } } });
  if (query.includes("MasadUpsellAdd")) return Response.json({ data: { orderEditAddVariant: { calculatedLineItem: { id: "line", originalUnitPriceSet: { shopMoney: { amount: "20", currencyCode: "USD" } } }, userErrors: [] } } });
  if (query.includes("MasadUpsellDiscount")) return Response.json({ data: { orderEditAddLineItemDiscount: { userErrors: [] } } });
  if (commitFails) throw new Error("connection lost");
  return Response.json({ data: { orderEditCommit: { order: { id: "order", currentTotalPriceSet: { shopMoney: { amount: "48" } } }, userErrors: [] } } });
}) });
describe("post-purchase order edits", () => {
  it("commits the selected variant and discount once, recording the new total", async () => {
    const admin = client();
    expect(await acceptPostUpsell("shop", admin, "{}", input())).toMatchObject({ ok: true, total: 48 });
    expect(admin.graphql).toHaveBeenCalledTimes(4);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "acceptance" }, data: { status: "ACCEPTED", orderTotal: 48 } });
  });
  it("returns a completed acceptance without sending any mutation again", async () => {
    mocks.find.mockResolvedValue({ status: "ACCEPTED", orderTotal: 48 });
    const admin = client();
    expect(await acceptPostUpsell("shop", admin, "{}", input())).toMatchObject({ duplicate: true });
    expect(admin.graphql).not.toHaveBeenCalled();
  });
  it("rejects a stale displayed price before claiming or editing the order", async () => {
    await expect(acceptPostUpsell("shop", client(), "{}", { ...input(), expectedPrice: 1 })).rejects.toThrow("cambió");
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("keeps an uncertain commit locked to prevent duplicate additions", async () => {
    await expect(acceptPostUpsell("shop", client(true), "{}", input())).rejects.toThrow("verificar");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.cartUpdate).not.toHaveBeenCalled();
  });
  it("does not edit an order that is already being edited", async () => {
    mocks.claim.mockResolvedValue({ count: 0 });
    const admin = client();
    await expect(acceptPostUpsell("shop", admin, "{}", input())).rejects.toThrow("actualizando");
    expect(admin.graphql).not.toHaveBeenCalled();
  });
});
