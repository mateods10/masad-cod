export type UpsellProduct = { id: string; title: string; image: string };
export type UpsellOffer = {
  id: string;
  product: UpsellProduct;
  variantId: string;
  variantTitle: string;
  price: number;
  discountPercent: number;
  headline: string;
};
export type UpsellCampaign = {
  id: string;
  name: string;
  active: boolean;
  mode: "PRE" | "POST";
  triggers: UpsellProduct[];
  offers: UpsellOffer[];
};
export function readUpsells(json: string | null | undefined): UpsellCampaign[] {
  try {
    const data = JSON.parse(json || "{}");
    return Array.isArray(data.upsells) ? data.upsells : [];
  } catch {
    return [];
  }
}
export function offerPrice(price: number, percent: number) {
  return Math.round(price * (100 - percent)) / 100;
}
export function matchingOffers(
  campaigns: UpsellCampaign[],
  productIds: string[],
  mode: "PRE" | "POST" = "PRE",
) {
  const ids = new Set(productIds);
  return campaigns
    .filter(
      (c) =>
        c.active && c.mode === mode && c.triggers.some((p) => ids.has(p.id)),
    )
    .flatMap((c) => c.offers.map((offer) => ({ ...offer, campaignId: c.id })))
    .filter((o) => !ids.has(o.product.id))
    .slice(0, 5);
}
export function validateUpsell(value: unknown): UpsellCampaign {
  const c = value as UpsellCampaign;
  const product = (p: UpsellProduct) =>
    p && /^gid:\/\/shopify\/Product\/\d+$/.test(p.id);
  if (!c || typeof c.name !== "string" || !c.name.trim() || c.name.length > 100)
    throw new Error("Escribe un nombre de hasta 100 caracteres.");
  if (c.mode !== "PRE" && c.mode !== "POST")
    throw new Error("Selecciona un modo de oferta válido.");
  if (
    !Array.isArray(c.triggers) ||
    !c.triggers.length ||
    c.triggers.length > 100 ||
    !c.triggers.every(product)
  )
    throw new Error(
      "Selecciona entre 1 y 100 productos que activen la oferta.",
    );
  if (!Array.isArray(c.offers) || !c.offers.length || c.offers.length > 5)
    throw new Error("Agrega entre 1 y 5 ofertas.");
  if (new Set(c.offers.map((o) => o.id)).size !== c.offers.length)
    throw new Error("Las ofertas no pueden estar duplicadas.");
  for (const o of c.offers) {
    if (
      !o ||
      typeof o.id !== "string" ||
      !/^[\w-]{1,80}$/.test(o.id) ||
      !product(o.product) ||
      !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(o.variantId)
    )
      throw new Error("Selecciona el producto y la variante de cada oferta.");
    if (
      !Number.isFinite(o.discountPercent) ||
      o.discountPercent < 0 ||
      o.discountPercent > 100
    )
      throw new Error("El descuento debe estar entre 0 y 100%.");
    if (c.triggers.some((p) => p.id === o.product.id))
      throw new Error(
        "El producto adicional debe ser distinto de los productos que activan la oferta.",
      );
  }
  return {
    id: c.id,
    name: c.name.trim(),
    active: c.active === true,
    mode: c.mode,
    triggers: c.triggers,
    offers: c.offers.map((o) => ({
      ...o,
      headline: String(o.headline || "Completa tu pedido").slice(0, 100),
    })),
  };
}
