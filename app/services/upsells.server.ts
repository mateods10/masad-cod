import type { AdminClient } from "./cart.server";
import {
  matchingOffers,
  offerPrice,
  readUpsells,
  type UpsellCampaign,
} from "../lib/upsells";

export const UPSELL_VARIANTS_QUERY = `#graphql
  query MasadUpsellVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id title price inventoryQuantity inventoryPolicy
        inventoryItem { tracked }
        product { id title status featuredImage { url } }
      }
    }
  }`;
export type UpsellVariant = {
  id: string;
  title: string;
  price: string;
  inventoryQuantity: number | null;
  inventoryPolicy: string;
  inventoryItem: { tracked: boolean };
  product: {
    id: string;
    title: string;
    status: string;
    featuredImage: { url: string } | null;
  };
};
export async function upsellVariants(admin: AdminClient, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, UpsellVariant>();
  if (unique.length > 100)
    throw new Error("Demasiados productos en la solicitud.");
  const response = await admin.graphql(UPSELL_VARIANTS_QUERY, {
    variables: { ids: unique },
  });
  const body = (await response.json()) as {
    data?: { nodes: Array<UpsellVariant | null> };
    errors?: { message: string }[];
  };
  if (body.errors?.length || !body.data)
    throw new Error("No se pudieron consultar los productos de Shopify.");
  return new Map(
    body.data.nodes
      .filter((v): v is UpsellVariant => Boolean(v?.product))
      .map((v) => [v.id, v]),
  );
}
export async function canonicalCampaign(admin: AdminClient, c: UpsellCampaign) {
  const variants = await upsellVariants(
    admin,
    c.offers.map((o) => o.variantId),
  );
  return {
    ...c,
    offers: c.offers.map((o) => {
      const v = variants.get(o.variantId);
      if (!v || v.product.id !== o.product.id || v.product.status !== "ACTIVE")
        throw new Error(
          "Uno de los productos de la oferta no está activo en esta tienda.",
        );
      return {
        ...o,
        product: {
          id: v.product.id,
          title: v.product.title,
          image: v.product.featuredImage?.url || "",
        },
        variantTitle: v.title,
        price: Number(v.price),
      };
    }),
  };
}
export async function quoteUpsells(
  admin: AdminClient,
  json: string,
  lines: Array<{ variantId: string | number }>,
  mode: "PRE" | "POST" = "PRE",
) {
  const campaigns = readUpsells(json);
  if (!campaigns.some(c => c.active && c.mode === mode)) return [];
  if (!Array.isArray(lines) || !lines.length || lines.length > 20) return [];
  const ids = lines.map((l) =>
    String(l.variantId).startsWith("gid://shopify/ProductVariant/")
      ? String(l.variantId)
      : `gid://shopify/ProductVariant/${l.variantId}`,
  );
  if (ids.some((id) => !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id)))
    throw new Error("Variante inválida.");
  const base = await upsellVariants(admin, ids);
  const offers = matchingOffers(
    campaigns,
    [...base.values()].map((v) => v.product.id),
    mode,
  );
  const variants = await upsellVariants(
    admin,
    offers.map((o) => o.variantId),
  );
  return offers.flatMap((o) => {
    const v = variants.get(o.variantId);
    if (
      !v ||
      v.product.status !== "ACTIVE" ||
      v.product.id !== o.product.id ||
      (v.inventoryItem.tracked &&
        v.inventoryPolicy === "DENY" &&
        (v.inventoryQuantity ?? 0) < 1)
    )
      return [];
    return [
      {
        ...o,
        product: {
          id: v.product.id,
          title: v.product.title,
          image: v.product.featuredImage?.url || "",
        },
        price: Number(v.price),
        finalPrice: offerPrice(Number(v.price), o.discountPercent),
        variantTitle: v.title,
      },
    ];
  });
}
