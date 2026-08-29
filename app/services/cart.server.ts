import type { AppConfig, CartSession } from "@prisma/client";
import db from "../db.server";
import {
  evaluateRisk,
  findRiskZoneMatch,
  hasEnoughInventory,
  nextAllowedSendAt,
  normalizeEcuadorPhone,
  normalizeText,
  provinceCode,
  sanitizeLineProperties,
  splitFullName,
  type CartLine,
} from "../lib/domain";
import { ensureShopData } from "./bootstrap.server";
import { sendPurchaseConversions } from "./conversion-api.server";
import { IP_BLOCKED_MESSAGE, registerCodAttempt } from "./fraud.server";
import {
  attributionOrderAttributes,
  detectMarketingPlatform,
  parseAttribution,
  shopifyReferringSite,
} from "./attribution.server";

export type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type CartPayload = {
  browserSessionId: string;
  fullName?: string;
  phone?: string;
  email?: string;
  province?: string;
  city?: string;
  sector?: string;
  address?: string;
  reference?: string;
  consentWhatsapp?: boolean;
  shippingMethod?: "FREE" | "PRIORITY" | "AGENCY";
  paymentMethod?: "COD" | "CARD";
  marketingAllowed?: boolean;
  pageUrl?: string;
  lines: Array<{ variantId: string | number; quantity: number; properties?: Array<{ name: string; value: string }> }>;
};

export type ConversionRequestContext = {
  clientIp?: string | null;
  userAgent?: string | null;
  cookieHeader?: string | null;
};

type ResolvedLine = CartLine & { productTitle: string; price: number };

function variantGid(value: string | number) {
  const raw = String(value);
  if (raw.startsWith("gid://shopify/ProductVariant/")) return raw;
  if (!/^\d+$/.test(raw)) throw new Error("Identificador de variante inválido");
  return `gid://shopify/ProductVariant/${raw}`;
}

async function resolveLines(admin: AdminClient, lines: CartPayload["lines"]): Promise<ResolvedLine[]> {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 20) throw new Error("El carrito no contiene productos válidos");
  const normalized = lines.map((line) => ({
    variantId: variantGid(line.variantId),
    quantity: Math.trunc(Number(line.quantity)),
    properties: sanitizeLineProperties(line.properties),
  }));
  if (normalized.some((line) => !Number.isFinite(line.quantity) || line.quantity < 1 || line.quantity > 100)) {
    throw new Error("La cantidad solicitada no es válida");
  }

  const response = await admin.graphql(
    `#graphql
      query GlobalAuraValidateVariants($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            price
            inventoryQuantity
            inventoryPolicy
            inventoryItem { tracked }
            product { title }
          }
        }
      }`,
    { variables: { ids: normalized.map((line) => line.variantId) } },
  );
  const body = (await response.json()) as {
    data?: { nodes?: Array<null | { id: string; title: string; price: string; inventoryQuantity: number | null; inventoryPolicy: string; inventoryItem: { tracked: boolean }; product: { title: string } }> };
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  const variants = new Map((body.data?.nodes ?? []).filter(Boolean).map((node) => [node!.id, node!]));

  return normalized.map((line) => {
    const variant = variants.get(line.variantId);
    if (!variant) throw new Error("Uno de los productos ya no está disponible");
    if (!hasEnoughInventory({
      tracked: variant.inventoryItem.tracked,
      policy: variant.inventoryPolicy,
      available: variant.inventoryQuantity,
      requested: line.quantity,
    })) {
      throw new Error(`No hay suficiente inventario para ${variant.product.title}`);
    }
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      productTitle: variant.product.title,
      title: variant.product.title,
      variantTitle: variant.title,
      price: Number(variant.price),
      unitPrice: Number(variant.price),
      properties: line.properties,
    };
  });
}

function clean(value: unknown, max = 250) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max) || undefined;
}

async function analyzeCart(shop: string, admin: AdminClient, payload: CartPayload, config: AppConfig) {
  const lines = await resolveLines(admin, payload.lines);
  const subtotal = lines.reduce((total, line) => total + line.price * line.quantity, 0);
  const zones = await db.riskZone.findMany({
    where: {
      shop,
      normalizedProvince: normalizeText(payload.province),
      normalizedCity: normalizeText(payload.city),
      active: true,
    },
    select: { province: true, city: true, sector: true },
  });
  const zone = findRiskZoneMatch(zones, payload);
  const risk = evaluateRisk({
    lines,
    subtotal,
    maxQuantity: config.riskMaxQuantity,
    maxOrderValue: Number(config.riskMaxOrderValue),
    zoneMatch: zone.type,
  });
  return { lines, subtotal, zone, risk };
}

export async function upsertCart(shop: string, admin: AdminClient, payload: CartPayload) {
  const config = await ensureShopData(shop);
  const analysis = await analyzeCart(shop, admin, payload, config);
  const now = new Date();
  const phoneNormalized = normalizeEcuadorPhone(payload.phone);
  const eligibleForRecovery = Boolean(phoneNormalized && payload.consentWhatsapp);
  const requestedShipping = payload.shippingMethod ?? "FREE";
  // Risk zones must not block or reroute the customer's order. They are an
  // operational alert for the advisor, who can offer Servientrega afterward.
  const shippingMethod = requestedShipping;
  const existing = await db.cartSession.findUnique({
    where: { shop_browserSessionId: { shop, browserSessionId: payload.browserSessionId } },
  });

  const cart = await db.cartSession.upsert({
    where: { shop_browserSessionId: { shop, browserSessionId: payload.browserSessionId } },
    update: {
      status: existing?.status === "ORDERED" ? "ORDERED" : "ACTIVE",
      fullName: clean(payload.fullName, 120),
      phone: clean(payload.phone, 30),
      phoneNormalized,
      email: clean(payload.email, 160)?.toLowerCase(),
      province: clean(payload.province, 80),
      city: clean(payload.city, 100),
      sector: config.sectorFieldEnabled ? clean(payload.sector, 120) : null,
      address: clean(payload.address, 220),
      reference: clean(payload.reference, 220),
      consentWhatsapp: Boolean(payload.consentWhatsapp),
      consentAt: payload.consentWhatsapp ? existing?.consentAt ?? now : null,
      shippingMethod,
      paymentMethod: payload.paymentMethod ?? "COD",
      subtotal: analysis.subtotal,
      linesJson: JSON.stringify(analysis.lines),
      riskScore: analysis.risk.score,
      riskReasonsJson: JSON.stringify(analysis.risk.reasons),
      riskZoneMatch: analysis.zone.zone?.sector,
      lastActivityAt: now,
      sendAt: eligibleForRecovery
        ? nextAllowedSendAt(now, config.delayHours, config.sendStartHour, config.sendEndHour)
        : null,
    },
    create: {
      shop,
      browserSessionId: payload.browserSessionId,
      fullName: clean(payload.fullName, 120),
      phone: clean(payload.phone, 30),
      phoneNormalized,
      email: clean(payload.email, 160)?.toLowerCase(),
      province: clean(payload.province, 80),
      city: clean(payload.city, 100),
      sector: config.sectorFieldEnabled ? clean(payload.sector, 120) : null,
      address: clean(payload.address, 220),
      reference: clean(payload.reference, 220),
      consentWhatsapp: Boolean(payload.consentWhatsapp),
      consentAt: payload.consentWhatsapp ? now : null,
      shippingMethod,
      paymentMethod: payload.paymentMethod ?? "COD",
      subtotal: analysis.subtotal,
      linesJson: JSON.stringify(analysis.lines),
      riskScore: analysis.risk.score,
      riskReasonsJson: JSON.stringify(analysis.risk.reasons),
      riskZoneMatch: analysis.zone.zone?.sector,
      lastActivityAt: now,
      sendAt: eligibleForRecovery
        ? nextAllowedSendAt(now, config.delayHours, config.sendStartHour, config.sendEndHour)
        : null,
    },
  });

  return { cart, config, analysis, shippingMethod };
}

function required(value: string | null | undefined, label: string) {
  if (!value?.trim()) throw new Error(`Falta ${label}`);
  return value.trim();
}

export function buildShopifyShippingAddress(input: {
  fullName: string;
  phone: string;
  address: string;
  reference: string;
  city: string;
  province: string;
}, options: { fullProvinceForPosCake?: boolean } = {}) {
  const { firstName, lastName } = splitFullName(input.fullName);
  const fullProvinceForPosCake = options.fullProvinceForPosCake === true;
  const provinceLabel = input.province
    .trim()
    .toLocaleLowerCase("es-EC")
    .replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("es-EC"));
  return {
    firstName,
    lastName,
    phone: input.phone,
    address1: input.address,
    address2: input.reference,
    city: input.city,
    // PosCake renders Shopify's Ecuador subdivision code (for example, "P")
    // instead of its full label. Luminos sends the complete province as a
    // separate structured field and omits only the abbreviated code, allowing
    // PosCake to recognize both city and province. Other installations keep
    // the original province plus provinceCode representation.
    ...(fullProvinceForPosCake ? { province: provinceLabel } : {
      province: input.province,
      provinceCode: provinceCode(input.province),
    }),
    countryCode: "EC",
  };
}

export function buildShopifyOrderLineItems(lines: CartLine[]) {
  return lines.map((line) => ({
    variantId: line.variantId,
    quantity: line.quantity,
    properties: line.properties,
    // orderCreate defaults this field to false, even when variantId belongs
    // to a physical product. PosCake needs a shippable order to create the
    // normal fulfillment/tracking workflow that triggers Pancake messages.
    requiresShipping: true,
  }));
}

function posCakeFullProvinceForAddress() {
  return process.env.POSCAKE_FULL_PROVINCE_IN_CITY === "1";
}

export async function createCodOrder(
  shop: string,
  admin: AdminClient,
  payload: CartPayload,
  clientIpHash: string | null = null,
  conversionContext?: ConversionRequestContext,
) {
  const result = await upsertCart(shop, admin, { ...payload, paymentMethod: "COD" });
  let cart = result.cart;
  if (cart.orderId) return { orderId: cart.orderId, orderName: "Pedido existente", cart, duplicate: true };

  const fullName = required(cart.fullName, "el nombre completo");
  const phone = required(cart.phoneNormalized, "un celular ecuatoriano válido");
  const email = required(cart.email, "el correo electrónico");
  const province = required(cart.province, "la provincia");
  const city = required(cart.city, "la ciudad");
  const address = required(cart.address, "la dirección");
  const reference = required(cart.reference, "la referencia");
  const manualBlock = await db.customerFraudBlock.findUnique({
    where: { shop_phoneNormalized: { shop, phoneNormalized: phone } },
  });
  if (manualBlock?.active) {
    const reasons = (() => {
      try { return JSON.parse(cart.riskReasonsJson) as string[]; } catch { return []; }
    })();
    const reason = "CLIENTE_BLOQUEADO_MANUALMENTE: celular marcado por el asesor.";
    await db.cartSession.update({
      where: { id: cart.id },
      data: {
        status: "BLOCKED_FRAUD",
        riskScore: 100,
        riskReasonsJson: JSON.stringify([...new Set([...reasons, reason])]),
        sendAt: null,
      },
    });
    throw new Error(IP_BLOCKED_MESSAGE);
  }
  const fraud = await registerCodAttempt(shop, cart.id, clientIpHash);
  if (fraud.flagged) {
    const reasons = (() => {
      try { return JSON.parse(cart.riskReasonsJson) as string[]; } catch { return []; }
    })();
    const reason = `POSIBLE_FRAUDE_POR_FRECUENCIA: ${fraud.attempts} pedidos COD desde la misma IP en 24 horas. Pedido permitido para revisión.`;
    cart = await db.cartSession.update({
      where: { id: cart.id },
      data: {
        riskScore: Math.max(cart.riskScore, 75),
        riskReasonsJson: JSON.stringify([...new Set([...reasons, reason])]),
      },
    });
  }
  const shippingFee = cart.shippingMethod === "PRIORITY" ? Number(result.config.priorityFee) : 0;
  const shippingLabel = cart.shippingMethod === "PRIORITY"
    ? "Envío prioritario"
    : cart.shippingMethod === "AGENCY"
      ? "Retiro en agencia Servientrega"
      : "Envío gratis";
  const shippingSummary = cart.shippingMethod === "PRIORITY"
    ? `${shippingLabel} (+$${shippingFee.toFixed(2)})`
    : shippingLabel;
  const reasons = JSON.parse(cart.riskReasonsJson) as string[];
  const attribution = parseAttribution(cart.attributionJson);
  const marketingPlatform = detectMarketingPlatform(cart.attributionJson);
  const tags = ["GLOBAL_AURA_FORM", "COD", cart.shippingMethod === "AGENCY" ? "RETIRO_SERVIENTREGA" : "ENVIO_DOMICILIO"];
  if (cart.shippingMethod === "PRIORITY") tags.push("ENVIO_PRIORITARIO");
  const isRiskZone = result.analysis.zone.type !== "NONE";
  if (isRiskZone) tags.push("ZONA_DE_RIESGO", "OFRECER_AGENCIA_SERVIENTREGA");
  if (cart.riskScore >= 25) tags.push("REVISAR_RIESGO");
  if (fraud.flagged) tags.push("POSIBLE_FRAUDE_FRECUENCIA");
  if (marketingPlatform === "TIKTOK") tags.push("ORIGEN_TIKTOK");
  if (marketingPlatform === "META") tags.push("ORIGEN_META");

  const claimed = await db.cartSession.updateMany({
    where: { id: cart.id, status: { in: ["ACTIVE", "CLICKED"] }, orderId: null },
    data: { status: "PLACING" },
  });
  if (claimed.count !== 1) {
    const current = await db.cartSession.findUniqueOrThrow({ where: { id: cart.id } });
    if (current.orderId) return { orderId: current.orderId, orderName: "Pedido existente", cart: current, duplicate: true };
    throw new Error("El pedido ya se está procesando. Espera unos segundos.");
  }

  try {
    const response = await admin.graphql(
      `#graphql
        mutation GlobalAuraCreateCodOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
          orderCreate(order: $order, options: $options) {
            order { id name displayFinancialStatus totalPriceSet { shopMoney { amount currencyCode } } }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          order: {
            currency: "USD",
            presentmentCurrency: "USD",
            email,
            phone,
            financialStatus: "PENDING",
            lineItems: buildShopifyOrderLineItems(result.analysis.lines),
            shippingAddress: buildShopifyShippingAddress({
              fullName,
              phone,
              address,
              reference,
              city,
              province,
            }, { fullProvinceForPosCake: posCakeFullProvinceForAddress() }),
            shippingLines: [
              {
                title: shippingLabel,
                code: cart.shippingMethod,
                source: "Global Aura Recuperación",
                priceSet: { shopMoney: { amount: shippingFee.toFixed(2), currencyCode: "USD" } },
              },
            ],
            tags,
            sourceIdentifier: cart.id,
            referringSite: shopifyReferringSite(cart.attributionJson),
            note: [
              `Método de envío: ${shippingSummary}`,
              `Referencia: ${reference}`,
              marketingPlatform ? `Plataforma de venta: ${marketingPlatform === "META" ? "Meta (Facebook/Instagram)" : "TikTok"}` : null,
              attribution.utm_source ? `Origen marketing: ${attribution.utm_source}${attribution.utm_medium ? ` / ${attribution.utm_medium}` : ""}` : null,
              attribution.utm_campaign ? `Campaña: ${attribution.utm_campaign}` : null,
              attribution.tt_campaignid ? `TikTok campaña: ${attribution.tt_campaignid}` : null,
              attribution.tt_adgroupid ? `TikTok grupo de anuncios: ${attribution.tt_adgroupid}` : null,
              attribution.tt_creativeid ? `TikTok creativo: ${attribution.tt_creativeid}` : null,
              attribution.full_url ? `URL de origen: ${attribution.full_url}` : null,
              attribution["shopify-cart-token"] ? `Shopify cart token: ${attribution["shopify-cart-token"]}` : null,
              isRiskZone
                ? "⚠️ ZONA DE RIESGO: ofrecer entrega en agencia Servientrega antes de despachar."
                : "Zona de entrega: sin alerta de riesgo.",
              `Riesgo: ${cart.riskScore}/100`,
              reasons.length ? `Motivos: ${reasons.join("; ")}` : "Sin alertas automáticas",
            ].filter(Boolean).join("\n"),
            customAttributes: [
              { key: "global_aura_session_id", value: cart.browserSessionId },
              { key: "Nombre completo", value: fullName },
              { key: "Celular", value: cart.phone ?? phone },
              { key: "Provincia", value: province },
              { key: "Ciudad", value: city },
              { key: "Dirección", value: address },
              { key: "Referencia", value: reference },
              { key: "Correo electrónico", value: email },
              { key: "Plataforma de venta", value: marketingPlatform === "META" ? "Meta (Facebook/Instagram)" : marketingPlatform === "TIKTOK" ? "TikTok" : "Sin identificar" },
              { key: "Método de envío", value: shippingSummary },
              { key: "Valor del envío", value: `$${shippingFee.toFixed(2)}` },
              { key: "Puntaje de riesgo", value: String(cart.riskScore) },
              { key: "Observación de entrega", value: isRiskZone ? "Zona de riesgo — ofrecer agencia Servientrega" : "Entrega normal" },
              ...attributionOrderAttributes(cart.attributionJson),
            ],
          },
          options: {
            inventoryBehaviour: "DECREMENT_OBEYING_POLICY",
            sendReceipt: true,
            sendFulfillmentReceipt: false,
          },
        },
      },
    );
    const body = (await response.json()) as {
      data?: { orderCreate?: { order?: { id: string; name: string; displayFinancialStatus: string; totalPriceSet: { shopMoney: { amount: string; currencyCode: string } } }; userErrors: Array<{ field?: string[]; message: string }> } };
      errors?: Array<{ message: string }>;
    };
    const errors = [...(body.errors ?? []), ...(body.data?.orderCreate?.userErrors ?? [])];
    if (errors.length || !body.data?.orderCreate?.order) throw new Error(errors.map((error) => error.message).join("; ") || "Shopify no creó el pedido");
    const order = body.data.orderCreate.order;
    const updated = await db.cartSession.update({
      where: { id: cart.id },
      data: { status: "ORDERED", orderId: order.id, orderTotal: Number(order.totalPriceSet.shopMoney.amount), recoveredAt: new Date(), sendAt: null },
    });
    if (payload.marketingAllowed !== false) {
      await sendPurchaseConversions({
        shop,
        orderId: order.id,
        orderName: order.name,
        cart: updated,
        lines: result.analysis.lines,
        total: Number(order.totalPriceSet.shopMoney.amount),
        pageUrl: payload.pageUrl,
        context: conversionContext,
      }).catch((conversionError) => {
        console.error("[conversion-api] No se pudo preparar el envío de Purchase", conversionError);
      });
    }
    return { orderId: order.id, orderName: order.name, cart: updated, duplicate: false };
  } catch (error) {
    await db.cartSession.update({ where: { id: cart.id }, data: { status: "ACTIVE" } });
    throw error;
  }
}

export async function hasMatchingOrder(admin: AdminClient, cart: CartSession) {
  if (!cart.phoneNormalized && !cart.email) return false;
  const date = cart.createdAt.toISOString().slice(0, 10);
  const response = await admin.graphql(
    `#graphql
      query GlobalAuraRecentOrders($query: String!) {
        orders(first: 100, reverse: true, sortKey: CREATED_AT, query: $query) {
          nodes { id createdAt phone email }
        }
      }`,
    { variables: { query: `created_at:>=${date}` } },
  );
  const body = (await response.json()) as { data?: { orders?: { nodes?: Array<{ id: string; createdAt: string; phone?: string; email?: string }> } } };
  return (body.data?.orders?.nodes ?? []).some((order) => {
    if (new Date(order.createdAt) < cart.createdAt) return false;
    return normalizeEcuadorPhone(order.phone) === cart.phoneNormalized || Boolean(cart.email && order.email?.toLowerCase() === cart.email.toLowerCase());
  });
}

export async function createAbandonedDraftOrder(admin: AdminClient, cart: CartSession) {
  if (cart.draftOrderId) {
    return { id: cart.draftOrderId, name: cart.draftOrderName ?? "Borrador existente" };
  }

  const lines = JSON.parse(cart.linesJson) as CartLine[];
  if (!lines.length) throw new Error("El carrito no tiene productos para crear el borrador");
  const recoveryUrl = `https://${cart.shop}/apps/global-aura-recovery/recover/${cart.recoveryToken}`;
  const { firstName, lastName } = splitFullName(cart.fullName ?? "Cliente sin completar");
  const hasAddress = Boolean(cart.address || cart.city || cart.province);
  const shippingAddress = hasAddress
    ? {
        firstName,
        lastName,
        phone: cart.phoneNormalized ?? undefined,
        address1: cart.address ?? undefined,
        address2: cart.reference ?? undefined,
        city: cart.city ?? undefined,
        ...(posCakeFullProvinceForAddress() && cart.province
          ? { province: cart.province
              .trim()
              .toLocaleLowerCase("es-EC")
              .replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("es-EC")) }
          : {
              provinceCode: cart.province ? provinceCode(cart.province) : undefined,
              province: cart.province ?? undefined,
            }),
        countryCode: "EC",
      }
    : undefined;

  const response = await admin.graphql(
    `#graphql
      mutation MasadCreateAbandonedDraft($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id name }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        input: {
          email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cart.email ?? "") ? cart.email : undefined,
          phone: cart.phoneNormalized ?? undefined,
          shippingAddress,
          lineItems: lines.map((line) => ({
            variantId: line.variantId,
            quantity: line.quantity,
            customAttributes: line.properties?.map((property) => ({ key: property.name, value: property.value })),
          })),
          tags: ["MASAD_COD", "CARRITO_ABANDONADO", "PANCAKE_BORRADOR"],
          note: [
            "BORRADOR DE CARRITO ABANDONADO",
            `Cliente: ${cart.fullName ?? "Sin completar"}`,
            `Celular: ${cart.phoneNormalized ?? cart.phone ?? "Sin completar"}`,
            `Dirección: ${cart.address ?? "Sin completar"}`,
            `Referencia: ${cart.reference ?? "Sin completar"}`,
            `Restaurar carrito: ${recoveryUrl}`,
          ].join("\n"),
          customAttributes: [
            { key: "Estado Masad", value: "BORRADOR" },
            { key: "Tipo", value: "CARRITO_ABANDONADO" },
            { key: "Masad cart session", value: cart.id },
            { key: "Enlace de recuperación", value: recoveryUrl },
            ...(cart.fullName ? [{ key: "Nombre completo", value: cart.fullName }] : []),
            ...(cart.phone ? [{ key: "Celular", value: cart.phone }] : []),
            ...(cart.province ? [{ key: "Provincia", value: cart.province }] : []),
            ...(cart.city ? [{ key: "Ciudad", value: cart.city }] : []),
            ...(cart.address ? [{ key: "Dirección", value: cart.address }] : []),
            ...(cart.reference ? [{ key: "Referencia", value: cart.reference }] : []),
            ...(cart.email ? [{ key: "Correo electrónico", value: cart.email }] : []),
          ],
        },
      },
    },
  );
  const body = (await response.json()) as {
    data?: { draftOrderCreate?: { draftOrder?: { id: string; name: string }; userErrors: Array<{ message: string }> } };
    errors?: Array<{ message: string }>;
  };
  const errors = [...(body.errors ?? []), ...(body.data?.draftOrderCreate?.userErrors ?? [])];
  const draft = body.data?.draftOrderCreate?.draftOrder;
  if (errors.length || !draft) {
    throw new Error(errors.map((error) => error.message).join("; ") || "Shopify no creó el borrador");
  }
  return draft;
}
