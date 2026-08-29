import { createHash } from "node:crypto";
import db from "../db.server";

export const IP_ATTEMPT_LIMIT = 3;
export const IP_ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const IP_BLOCKED_MESSAGE = "No es posible procesar este pedido. Comunícate con nuestro equipo de atención.";

function isPublicIp(value: string) {
  const ip = value.trim().replace(/^::ffff:/i, "");
  if (!ip || ip === "::1" || ip === "0.0.0.0") return false;
  if (/^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip)) return false;
  return /^[0-9a-f:.]+$/i.test(ip);
}

export function clientIpAddress(headers: Headers) {
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    ...String(headers.get("x-forwarded-for") ?? "").split(","),
  ];
  return candidates.map((value) => value?.trim().replace(/^::ffff:/i, "") ?? "").find(isPublicIp) ?? null;
}

export function hashClientIp(headers: Headers, shop: string) {
  const ip = clientIpAddress(headers);
  if (!ip) return null;
  const secret = process.env.FRAUD_IP_HASH_KEY ?? process.env.SHOPIFY_API_SECRET;
  if (!secret) return null;
  return createHash("sha256").update(`masad-ip-v1:${secret}:${shop}:${ip}`).digest("base64url");
}

export function isFrequentCodActivity(attempts: number) {
  return attempts >= IP_ATTEMPT_LIMIT;
}

export async function registerCodAttempt(shop: string, cartSessionId: string, clientIpHash: string | null) {
  if (!clientIpHash) return { flagged: false, attempts: 0 };
  return db.$transaction(async (tx) => {
    await tx.fraudIpAttempt.upsert({
      where: { cartSessionId },
      create: { shop, clientIpHash, cartSessionId },
      update: {},
    });
    const attempts = await tx.fraudIpAttempt.count({
      where: { shop, clientIpHash, createdAt: { gte: new Date(Date.now() - IP_ATTEMPT_WINDOW_MS) } },
    });
    const flagged = isFrequentCodActivity(attempts);
    if (flagged) {
      await tx.fraudIpBlock.upsert({
        where: { shop_clientIpHash: { shop, clientIpHash } },
        create: {
          shop,
          clientIpHash,
          attemptCount: attempts,
          reason: `${attempts} pedidos COD desde la misma IP en las últimas 24 horas. Alerta sin bloqueo automático.`,
        },
        update: {
          attemptCount: attempts,
          reason: `${attempts} pedidos COD desde la misma IP en las últimas 24 horas. Alerta sin bloqueo automático.`,
        },
      });
    }
    return { flagged, attempts };
  });
}
