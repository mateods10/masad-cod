import { createHmac, timingSafeEqual } from "node:crypto";
import db from "../db.server";
import type { AdminClient } from "./cart.server";
import { DEFAULT_INTEGRATIONS, parseSettings } from "./app-settings.server";
import { normalizeEcuadorPhone } from "../lib/domain";

function signature(value: string) {
  if (!process.env.SHOPIFY_API_SECRET) throw new Error("Configuración de WhatsApp no disponible.");
  return createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(`whatsapp-confirmation:${value}`).digest("base64url");
}
export function confirmationToken(shop: string, cartId: string) {
  const value = Buffer.from(JSON.stringify({ shop, cartId, expires: Date.now() + 60 * 60_000 })).toString("base64url");
  return `${value}.${signature(value)}`;
}
export function verifyConfirmationToken(shop: string, token: string) {
  if (typeof token !== "string" || token.length > 2000 || token.split(".").length !== 2) throw new Error("Enlace de confirmación inválido.");
  const [value, sig] = token.split(".");
  const expected = Buffer.from(signature(value)); const received = Buffer.from(sig);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error("Enlace de confirmación inválido.");
  const data = JSON.parse(Buffer.from(value, "base64url").toString()) as { shop: string; cartId: string; expires: number };
  if (data.shop !== shop || !data.cartId || !Number.isFinite(data.expires) || data.expires < Date.now()) throw new Error("El enlace de confirmación venció. Tu pedido sigue registrado.");
  return data.cartId;
}
export function whatsappSettings(json: string) {
  const settings = parseSettings(json, DEFAULT_INTEGRATIONS);
  return { enabled: settings.whatsappConfirmationEnabled === true, phone: normalizeEcuadorPhone(settings.whatsappPhone), storeName: settings.whatsappStoreName.trim() };
}
export const WHATSAPP_ORDER_QUERY = `#graphql
 query MasadWhatsappOrder($id: ID!) {
   order(id: $id) {
     id name cancelledAt
     currentTotalPriceSet { shopMoney { amount currencyCode } }
     lineItems(first: 100) { nodes { title variantTitle currentQuantity } pageInfo { hasNextPage } }
     shippingAddress { name address1 address2 city province phone }
     shippingLines(first: 10) { nodes { title } }
   }
 }`;
export type ConfirmationOrder = {
  id: string; name: string; cancelledAt: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: { nodes: Array<{ title: string; variantTitle: string | null; currentQuantity: number }>; pageInfo: { hasNextPage: boolean } };
  shippingAddress: { name: string | null; address1: string | null; address2: string | null; city: string | null; province: string | null; phone: string | null } | null;
  shippingLines: { nodes: Array<{ title: string }> };
};
const clean = (v: unknown) => String(v || "").replace(/[\r\n]+/g, " ").trim();
export function buildConfirmationMessage(storeName: string, order: ConfirmationOrder, phone: string) {
  const address = order.shippingAddress;
  const money = order.currentTotalPriceSet.shopMoney;
  const total = new Intl.NumberFormat("es-EC", { style: "currency", currency: money.currencyCode }).format(Number(money.amount));
  return [
    `¡Hola, equipo de ${clean(storeName)}! 👋`,
    "", "Hice un pedido en su tienda y les escribo para confirmar los datos. 😊",
    "", "— DETALLES DE MI PEDIDO —", "",
    `Número de pedido: ${clean(order.name)}`, "🛍 Productos:",
    ...order.lineItems.nodes.filter(l => l.currentQuantity > 0).map(l => `${l.currentQuantity} × ${clean(l.title)}${l.variantTitle && l.variantTitle !== "Default Title" ? ` · ${clean(l.variantTitle)}` : ""}`),
    "", `💰 Total a pagar al recibir: ${total} ${money.currencyCode}`,
    "Método de pago: Pago contra entrega",
    `🚚 Envío: ${order.shippingLines.nodes.map(l => clean(l.title)).join(", ") || "Según mi pedido"}`,
    "", `👤 Nombre: ${clean(address?.name)}`, `📞 Teléfono: ${phone}`,
    `📍 Dirección: ${[address?.address1, address?.city, address?.province].map(clean).filter(Boolean).join(", ")}`,
    ...(address?.address2 ? [`Referencia: ${clean(address.address2)}`] : []),
    "", "¿Me confirman si todo está correcto para preparar mi pedido?",
    "Por favor, avísenme cuando sea despachado. ¡Muchas gracias! 😊",
  ].join("\n");
}
export async function getWhatsappConfirmation(shop: string, admin: AdminClient, json: string, token: string) {
  const settings = whatsappSettings(json);
  if (!settings.enabled || !settings.phone || !settings.storeName) return { enabled: false };
  const cart = await db.cartSession.findFirst({ where: { id: verifyConfirmationToken(shop, token), shop, status: "ORDERED", consentWhatsapp: true } });
  if (!cart?.orderId) throw new Error("No se encontró un pedido para confirmar.");
  if (cart.upsellEditing) throw new Error("Estamos verificando el total final de tu pedido. Inténtalo nuevamente en unos momentos.");
  const response = await admin.graphql(WHATSAPP_ORDER_QUERY, { variables: { id: cart.orderId } });
  const body = await response.json() as { data?: { order: ConfirmationOrder | null }; errors?: { message: string }[] };
  const order = body.data?.order;
  if (body.errors?.length || !order || order.cancelledAt || order.lineItems.pageInfo.hasNextPage) throw new Error("No se pudo consultar el resumen final. Tu pedido sigue registrado; intenta abrir WhatsApp nuevamente.");
  const text = buildConfirmationMessage(settings.storeName, order, normalizeEcuadorPhone(order.shippingAddress?.phone) || cart.phoneNormalized || "");
  // Returning the link does not send a message or mark the order as confirmed.
  return { enabled: true, url: `https://wa.me/${settings.phone.slice(1)}?text=${encodeURIComponent(text)}`, orderName: order.name };
}
