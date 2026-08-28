import { createHash } from "node:crypto";
import type { CartSession, TrackingPixel } from "@prisma/client";

import db from "../db.server";
import type { CartLine } from "../lib/domain";
import { decryptCredential } from "./credentials.server";
import { parseAttribution } from "./attribution.server";

type ConversionContext = {
  clientIp?: string | null;
  userAgent?: string | null;
  cookieHeader?: string | null;
};

type PurchaseInput = {
  shop: string;
  orderId: string;
  orderName: string;
  cart: CartSession;
  lines: CartLine[];
  total: number;
  pageUrl?: string;
  context?: ConversionContext;
};

function sha256(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : undefined;
}

function cookieValue(header: string | null | undefined, name: string) {
  const encodedName = `${name}=`;
  const match = String(header ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(encodedName));
  return match ? decodeURIComponent(match.slice(encodedName.length)) : undefined;
}

function variantId(value: string) {
  return value.split("/").pop() ?? value;
}

function customerNames(fullName: string | null) {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function trackingValues(input: PurchaseInput) {
  const { firstName, lastName } = customerNames(input.cart.fullName);
  const attribution = parseAttribution(input.cart.attributionJson);
  const url = attribution.full_url || input.pageUrl || `https://${input.shop}`;
  const query = (() => { try { return new URL(url).searchParams; } catch { return new URLSearchParams(); } })();
  const cookieHeader = input.context?.cookieHeader;
  const fbclid = query.get("fbclid");
  const fbc = cookieValue(cookieHeader, "_fbc") || (fbclid ? `fb.1.${Math.floor(Date.now() / 1000)}.${fbclid}` : undefined);
  return {
    url,
    firstName,
    lastName,
    emailHash: sha256(input.cart.email),
    phoneHash: sha256(input.cart.phoneNormalized?.replace(/\D/g, "")),
    firstNameHash: sha256(firstName),
    lastNameHash: sha256(lastName),
    cityHash: sha256(input.cart.city),
    provinceHash: sha256(input.cart.province),
    countryHash: sha256("ec"),
    fbp: cookieValue(cookieHeader, "_fbp"),
    fbc,
    ttp: cookieValue(cookieHeader, "_ttp"),
    ttclid: attribution.ttclid || query.get("ttclid") || undefined,
  };
}

export function buildMetaPurchasePayload(input: PurchaseInput, pixel: Pick<TrackingPixel, "testEventCode">) {
  const values = trackingValues(input);
  const userData: Record<string, unknown> = {
    em: values.emailHash ? [values.emailHash] : undefined,
    ph: values.phoneHash ? [values.phoneHash] : undefined,
    fn: values.firstNameHash ? [values.firstNameHash] : undefined,
    ln: values.lastNameHash ? [values.lastNameHash] : undefined,
    ct: values.cityHash ? [values.cityHash] : undefined,
    st: values.provinceHash ? [values.provinceHash] : undefined,
    country: values.countryHash ? [values.countryHash] : undefined,
    client_ip_address: input.context?.clientIp || undefined,
    client_user_agent: input.context?.userAgent || undefined,
    fbp: values.fbp,
    fbc: values.fbc,
  };
  Object.keys(userData).forEach((key) => userData[key] === undefined && delete userData[key]);
  const payload: Record<string, unknown> = {
    data: [{
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      event_id: input.orderId,
      event_source_url: values.url,
      action_source: "website",
      user_data: userData,
      custom_data: {
        currency: "USD",
        value: Number(input.total.toFixed(2)),
        order_id: input.orderName,
        content_type: "product",
        content_ids: input.lines.map((line) => variantId(line.variantId)),
        contents: input.lines.map((line) => ({
          id: variantId(line.variantId),
          quantity: line.quantity,
          item_price: Number(line.unitPrice),
        })),
      },
    }],
  };
  if (pixel.testEventCode) payload.test_event_code = pixel.testEventCode;
  return payload;
}

export function buildTikTokPurchasePayload(input: PurchaseInput, pixel: Pick<TrackingPixel, "testEventCode">) {
  const values = trackingValues(input);
  const user: Record<string, unknown> = {
    email: values.emailHash ? [values.emailHash] : undefined,
    phone: values.phoneHash ? [values.phoneHash] : undefined,
    external_id: values.phoneHash ? [values.phoneHash] : undefined,
    ip: input.context?.clientIp || undefined,
    user_agent: input.context?.userAgent || undefined,
    ttp: values.ttp,
    ttclid: values.ttclid,
  };
  Object.keys(user).forEach((key) => user[key] === undefined && delete user[key]);
  const payload: Record<string, unknown> = {
    event_source: "web",
    data: [{
      event: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      event_id: input.orderId,
      user,
      page: { url: values.url },
      properties: {
        currency: "USD",
        value: Number(input.total.toFixed(2)),
        order_id: input.orderName,
        content_type: "product",
        contents: input.lines.map((line) => ({
          content_id: variantId(line.variantId),
          content_type: "product",
          content_name: line.title,
          quantity: line.quantity,
          price: Number(line.unitPrice),
        })),
      },
    }],
  };
  if (pixel.testEventCode) payload.test_event_code = pixel.testEventCode;
  return payload;
}

async function sendMeta(pixel: TrackingPixel, token: string, input: PurchaseInput) {
  const version = process.env.META_GRAPH_API_VERSION ?? "v23.0";
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(pixel.pixelId)}/events`);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildMetaPurchasePayload(input, pixel)),
    signal: AbortSignal.timeout(6000),
  });
  const body = await response.json().catch(() => ({})) as { error?: { message?: string }; events_received?: number };
  if (!response.ok || body.error || typeof body.events_received !== "number") {
    throw new Error(body.error?.message || `Meta respondió HTTP ${response.status}`);
  }
}

async function sendTikTok(pixel: TrackingPixel, token: string, input: PurchaseInput) {
  const response = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
    method: "POST",
    headers: { "content-type": "application/json", "Access-Token": token },
    body: JSON.stringify({ ...buildTikTokPurchasePayload(input, pixel), event_source_id: pixel.pixelId }),
    signal: AbortSignal.timeout(6000),
  });
  const body = await response.json().catch(() => ({})) as { code?: number; message?: string };
  if (!response.ok || body.code !== 0) throw new Error(body.message || `TikTok respondió HTTP ${response.status}`);
}

async function sendOne(pixel: TrackingPixel, input: PurchaseInput) {
  try {
    if (!pixel.apiToken) throw new Error("Falta el token de acceso");
    const token = decryptCredential(pixel.apiToken);
    if (pixel.platform === "META") await sendMeta(pixel, token, input);
    else if (pixel.platform === "TIKTOK") await sendTikTok(pixel, token, input);
    else throw new Error("Plataforma no compatible");
    await db.trackingPixel.update({ where: { id: pixel.id }, data: { lastSentAt: new Date(), lastError: null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo enviar la conversión";
    await db.trackingPixel.update({ where: { id: pixel.id }, data: { lastError: message.slice(0, 1000) } }).catch(() => undefined);
    console.error(`[conversion-api] ${pixel.platform} ${pixel.pixelId}: ${message}`);
  }
}

export async function sendConversionTest(pixel: TrackingPixel, testEventCode: string) {
  if (!pixel.apiToken) throw new Error("Primero guarda el token de acceso");
  const code = testEventCode.trim().slice(0, 120);
  if (!code) throw new Error("Escribe el código de evento de prueba");
  const now = Date.now();
  const input: PurchaseInput = {
    shop: pixel.shop,
    orderId: `masad-test-${now}`,
    orderName: `MASAD-TEST-${now}`,
    cart: {
      fullName: "Masad Evento Prueba",
      phoneNormalized: "+593999999999",
      email: "test@masad.invalid",
      city: "Quito",
      province: "Pichincha",
      attributionJson: JSON.stringify({ full_url: `https://${pixel.shop}/` }),
    } as CartSession,
    lines: [{
      variantId: "gid://shopify/ProductVariant/1",
      quantity: 1,
      unitPrice: 0.01,
      title: "Evento de prueba Masad",
      variantTitle: "Prueba",
      properties: [],
    }],
    total: 0.01,
    pageUrl: `https://${pixel.shop}/`,
    context: { userAgent: "Masad COD Events API test" },
  };
  const testPixel = { ...pixel, testEventCode: code };
  try {
    const token = decryptCredential(pixel.apiToken);
    if (pixel.platform === "META") await sendMeta(testPixel, token, input);
    else if (pixel.platform === "TIKTOK") await sendTikTok(testPixel, token, input);
    else throw new Error("Plataforma no compatible");
    await db.trackingPixel.update({ where: { id: pixel.id }, data: { lastSentAt: new Date(), lastError: null, testEventCode: null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo enviar la prueba";
    await db.trackingPixel.update({ where: { id: pixel.id }, data: { lastError: message.slice(0, 1000), testEventCode: null } }).catch(() => undefined);
    throw new Error(message);
  }
}

export async function sendPurchaseConversions(input: PurchaseInput) {
  const pixels = await db.trackingPixel.findMany({
    where: { shop: input.shop, active: true, purchase: true, apiToken: { not: null } },
  });
  await Promise.allSettled(pixels.map((pixel) => sendOne(pixel, input)));
}
