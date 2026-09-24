import { createHmac, timingSafeEqual } from "node:crypto";
import db from "../db.server";
import type { AdminClient } from "./cart.server";
import { quoteUpsells } from "./upsells.server";
import { offerPrice } from "../lib/upsells";

function sign(value: string) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("Configuración de firma no disponible.");
  return createHmac("sha256", secret).update(value).digest("base64url");
}
export function postUpsellToken(shop: string, cartId: string) {
  const value = Buffer.from(
    JSON.stringify({ shop, cartId, expires: Date.now() + 15 * 60_000 }),
  ).toString("base64url");
  return `${value}.${sign(value)}`;
}
export function verifyPostToken(shop: string, token: string) {
  if (typeof token !== "string" || token.length > 2000)
    throw new Error("Oferta vencida.");
  const [value, signature] = token.split(".");
  const expected = Buffer.from(sign(value || ""));
  const received = Buffer.from(signature || "");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(expected, received)
  )
    throw new Error("Oferta inválida.");
  const data = JSON.parse(Buffer.from(value, "base64url").toString()) as {
    shop: string;
    cartId: string;
    expires: number;
  };
  if (
    data.shop !== shop ||
    !Number.isFinite(data.expires) ||
    data.expires < Date.now()
  )
    throw new Error("La oferta venció. Tu pedido original sigue confirmado.");
  return data.cartId;
}
export async function postCart(shop: string, token: string) {
  const cart = await db.cartSession.findFirst({
    where: { id: verifyPostToken(shop, token), shop, status: "ORDERED" },
  });
  if (!cart?.orderId) throw new Error("No se encontró el pedido confirmado.");
  if (!cart.recoveredAt || Date.now() - cart.recoveredAt.getTime() > 15 * 60_000) throw new Error("La oferta venció. Tu pedido sigue confirmado.");
  return cart;
}
export const BEGIN_EDIT = `#graphql
 mutation MasadUpsellBegin($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id } userErrors { message } } }`;
export const ADD_VARIANT = `#graphql
 mutation MasadUpsellAdd($id: ID!, $variant: ID!) { orderEditAddVariant(id: $id, variantId: $variant, quantity: 1, allowDuplicates: true) { calculatedLineItem { id originalUnitPriceSet { shopMoney { amount currencyCode } } } userErrors { message } } }`;
export const ADD_DISCOUNT = `#graphql
 mutation MasadUpsellDiscount($id: ID!, $line: ID!, $discount: OrderEditAppliedDiscountInput!) { orderEditAddLineItemDiscount(id: $id, lineItemId: $line, discount: $discount) { calculatedLineItem { id } userErrors { message } } }`;
export const COMMIT_EDIT = `#graphql
 mutation MasadUpsellCommit($id: ID!, $note: String!) { orderEditCommit(id: $id, notifyCustomer: false, staffNote: $note) { order { id name currentTotalPriceSet { shopMoney { amount currencyCode } } } userErrors { message } } }`;
async function mutate<T>(
  admin: AdminClient,
  query: string,
  variables: Record<string, unknown>,
  field: string,
) {
  const response = await admin.graphql(query, { variables });
  const body = (await response.json()) as {
    data?: Record<string, T & { userErrors?: { message: string }[] }>;
    errors?: { message: string }[];
  };
  const result = body.data?.[field];
  const errors = [...(body.errors || []), ...(result?.userErrors || [])];
  if (!result || errors.length)
    throw new Error(
      errors.map((e) => e.message).join("; ") ||
        "Shopify no pudo actualizar el pedido.",
    );
  return result;
}
export async function acceptPostUpsell(
  shop: string,
  admin: AdminClient,
  json: string,
  input: {
    token: string;
    campaignId: string;
    offerId: string;
    expectedPrice: number;
  },
) {
  const cart = await postCart(shop, input.token);
  const orderId = cart.orderId!;
  const key = {
    shop,
    orderId,
    campaignId: input.campaignId,
    offerId: input.offerId,
  };
  const existing = await db.upsellAcceptance.findUnique({
    where: { shop_orderId_campaignId_offerId: key },
  });
  if (existing?.status === "ACCEPTED")
    return { ok: true, total: Number(existing.orderTotal), duplicate: true };
  if (existing)
    throw new Error(
      "Esta oferta ya se está verificando. No vuelvas a agregarla; tu pedido original sigue confirmado.",
    );
  const offers = await quoteUpsells(
    admin,
    json,
    JSON.parse(cart.linesJson),
    "POST",
  );
  const offer = offers.find(
    (o) => o.campaignId === input.campaignId && o.id === input.offerId,
  );
  if (!offer || offer.finalPrice !== input.expectedPrice)
    throw new Error(
      "La oferta cambió o ya no está disponible. Tu pedido original sigue confirmado.",
    );
  // Claim an order-wide lock: simultaneous offers must not overwrite edits.
  const claim = await db.cartSession.updateMany({
    where: { id: cart.id, status: "ORDERED", upsellEditing: false },
    data: { upsellEditing: true },
  });
  if (!claim.count)
    throw new Error("Tu pedido se está actualizando. Espera unos segundos.");
  let acceptanceId: string | undefined;
  let committing = false;
  try {
    const acceptance = await db.upsellAcceptance.create({ data: key });
    acceptanceId = acceptance.id;
    const start = await mutate<{ calculatedOrder: { id: string } }>(
      admin,
      BEGIN_EDIT,
      { id: orderId },
      "orderEditBegin",
    );
    const id = start.calculatedOrder.id;
    const added = await mutate<{ calculatedLineItem: { id: string; originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } } } }>(
      admin,
      ADD_VARIANT,
      { id, variant: offer.variantId },
      "orderEditAddVariant",
    );
    const applied = added.calculatedLineItem.originalUnitPriceSet.shopMoney;
    if (applied.currencyCode !== "USD" || offerPrice(Number(applied.amount), offer.discountPercent) !== input.expectedPrice) throw new Error("El precio cambió. La oferta no se agregó a tu pedido.");
    if (offer.discountPercent > 0)
      await mutate(
        admin,
        ADD_DISCOUNT,
        {
          id,
          line: added.calculatedLineItem.id,
          discount: {
            percentValue: offer.discountPercent,
            description: `Masad upsell: ${offer.headline}`,
          },
        },
        "orderEditAddLineItemDiscount",
      );
    committing = true;
    const result = await mutate<{
      order: {
        id: string;
        name: string;
        currentTotalPriceSet: { shopMoney: { amount: string } };
      };
    }>(
      admin,
      COMMIT_EDIT,
      {
        id,
        note: `Upsell aceptado por el cliente: ${offer.product.title} (${acceptance.id})`,
      },
      "orderEditCommit",
    );
    const total = Number(result.order.currentTotalPriceSet.shopMoney.amount);
    await db.$transaction([
      db.upsellAcceptance.update({
        where: { id: acceptance.id },
        data: { status: "ACCEPTED", orderTotal: total },
      }),
      db.cartSession.update({
        where: { id: cart.id },
        data: { orderTotal: total, upsellEditing: false },
      }),
    ]);
    return { ok: true, total, duplicate: false };
  } catch (error) {
    // After commit starts its result may be uncertain. Retain the claim to
    // prevent a retry from adding the same item twice after a network failure.
    if (acceptanceId && !committing)
      await db.upsellAcceptance.delete({ where: { id: acceptanceId } });
    if (!committing)
      await db.cartSession.update({
        where: { id: cart.id },
        data: { upsellEditing: false },
      });
    if (committing)
      throw new Error(
        "No pudimos verificar la actualización. Tu pedido está confirmado; contacta a la tienda antes de volver a agregar esta oferta.",
      );
    throw error;
  }
}
