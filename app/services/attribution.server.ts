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
  "fbclid",
  "referrer_url",
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
    // Keep the most recent marketing touch. A customer can return through a
    // different campaign before ordering, so retaining the first value forever
    // assigns later orders to the wrong platform or campaign.
    if (incoming[key]) merged[key] = incoming[key];
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
  const visibleAttributes: Array<[keyof MarketingAttribution, string]> = [
    ["utm_source", "Origen marketing"],
    ["utm_medium", "Medio marketing"],
    ["utm_campaign", "Campaña marketing"],
    ["utm_id", "ID de campaña"],
    ["utm_content", "Contenido del anuncio"],
    ["tt_campaignid", "TikTok · campaña ID"],
    ["tt_adgroupid", "TikTok · grupo ID"],
    ["tt_creativeid", "TikTok · creativo ID"],
  ];
  return visibleAttributes.flatMap(([key, label]) => attribution[key]
    ? [{ key: label, value: attribution[key]!.slice(0, 255) }]
    : []);
}

export type MarketingPlatform = "META" | "TIKTOK";

function hostname(value: string | undefined) {
  if (!value) return "";
  try { return new URL(value).hostname.toLowerCase(); } catch { return ""; }
}

function queryValue(value: string | undefined, key: string) {
  if (!value) return "";
  try { return new URL(value).searchParams.get(key)?.trim() ?? ""; } catch { return ""; }
}

export function detectMarketingPlatform(value: string | null | undefined): MarketingPlatform | null {
  const attribution = parseAttribution(value);
  const source = attribution.utm_source?.trim().toLowerCase() ?? "";
  const referrerHost = hostname(attribution.referrer_url);
  const landingTtclid = queryValue(attribution.full_url, "ttclid");
  const landingFbclid = queryValue(attribution.full_url, "fbclid");

  if (
    source.includes("tiktok")
    || Boolean(attribution.ttclid || landingTtclid)
    || referrerHost === "tiktok.com"
    || referrerHost.endsWith(".tiktok.com")
  ) return "TIKTOK";

  if (
    ["meta", "facebook", "fb", "instagram", "ig"].includes(source)
    || Boolean(attribution.fbclid || landingFbclid)
    || referrerHost === "facebook.com"
    || referrerHost.endsWith(".facebook.com")
    || referrerHost === "instagram.com"
    || referrerHost.endsWith(".instagram.com")
  ) return "META";

  return null;
}

export function shopifyReferringSite(value: string | null | undefined) {
  const attribution = parseAttribution(value);
  const platform = detectMarketingPlatform(value);
  const referrerHost = hostname(attribution.referrer_url);

  if (platform === "TIKTOK") {
    return referrerHost.includes("tiktok.com") ? attribution.referrer_url : "https://www.tiktok.com/";
  }

  if (platform === "META") {
    const source = attribution.utm_source?.trim().toLowerCase() ?? "";
    const isInstagram = source === "instagram" || source === "ig" || referrerHost.includes("instagram.com");
    return isInstagram ? "https://www.instagram.com/" : "https://www.facebook.com/";
  }

  return attribution.referrer_url && /^https?:\/\//i.test(attribution.referrer_url)
    ? attribution.referrer_url
    : undefined;
}
