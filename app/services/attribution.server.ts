import db from "../db.server";

export const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_id",
  "utm_term",
  "utm_content",
  "tt_campaignid",
  "tt_adgroupid",
  "tt_creativeid",
  "ttclid",
  "full_url",
  "shopify-cart-token",
] as const;

export type MarketingAttribution = Partial<Record<(typeof ATTRIBUTION_KEYS)[number], string>>;

function clean(value: unknown, max: number) {
  return String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
}

export function sanitizeAttribution(input: unknown): MarketingAttribution {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  return Object.fromEntries(ATTRIBUTION_KEYS.flatMap((key) => {
    const value = clean(source[key], key === "full_url" ? 2000 : 255);
    return value ? [[key, value]] : [];
  })) as MarketingAttribution;
}

export function parseAttribution(value: string | null | undefined): MarketingAttribution {
  try { return sanitizeAttribution(JSON.parse(value || "{}")); } catch { return {}; }
}

export function mergeAttribution(existing: MarketingAttribution, incoming: MarketingAttribution) {
  const merged = { ...existing };
  for (const key of ATTRIBUTION_KEYS) {
    if (key === "shopify-cart-token") {
      if (incoming[key]) merged[key] = incoming[key];
    } else if (!merged[key] && incoming[key]) {
      merged[key] = incoming[key];
    }
  }
  return merged;
}

export async function captureAttribution(shop: string, browserSessionId: string, input: unknown) {
  const incoming = sanitizeAttribution(input);
  const existing = await db.cartSession.findUnique({
    where: { shop_browserSessionId: { shop, browserSessionId } },
    select: { attributionJson: true },
  });
  const attribution = mergeAttribution(parseAttribution(existing?.attributionJson), incoming);
  return db.cartSession.upsert({
    where: { shop_browserSessionId: { shop, browserSessionId } },
    update: { attributionJson: JSON.stringify(attribution) },
    create: { shop, browserSessionId, attributionJson: JSON.stringify(attribution) },
    select: { id: true },
  });
}

export function attributionOrderAttributes(value: string | null | undefined) {
  const attribution = parseAttribution(value);
  return ATTRIBUTION_KEYS.flatMap((key) => attribution[key]
    ? [{ key, value: attribution[key]!.slice(0, 255) }]
    : []);
}
