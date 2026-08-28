import type { AppConfig, CartSession } from "@prisma/client";
import { decryptCredential } from "./credentials.server";

export const RECOVERY_MESSAGE = `🛍️ *¡Tu compra quedó pendiente!*

Vimos que dejaste algunos productos en tu carrito y queremos ayudarte a completar tu compra 💖

✨ Tus productos todavía están disponibles.
🚚 *Envío GRATIS*
💵 *Paga al recibir tu pedido*

Puedes continuar tu compra exactamente donde la dejaste aquí 👇
🔗 {{1}}

¡Finaliza tu compra antes de que se agote el stock! 🔥`;

export type PancakeSendResult = {
  status: "SENT" | "SIMULATED";
  providerId?: string;
  response: unknown;
};

type PancakeConfig = Pick<AppConfig,
  "pancakeMode" | "pancakeEndpoint" | "pancakePageId" | "pancakeAccessToken" | "pancakeTemplateId"
>;

export async function sendRecoveryViaPancake(cart: CartSession, config?: PancakeConfig | null): Promise<PancakeSendResult> {
  const recoveryUrl = `https://${cart.shop}/apps/global-aura-recovery/recover/${cart.recoveryToken}`;
  const mode = config?.pancakeMode ?? process.env.PANCAKE_MODE ?? "mock";

  if (mode !== "api") {
    return {
      status: "SIMULATED",
      providerId: `mock-${cart.id}`,
      response: { phone: cart.phoneNormalized, recoveryUrl, template: RECOVERY_MESSAGE },
    };
  }

  const pageId = config?.pancakePageId ?? process.env.PANCAKE_PAGE_ID;
  const pageAccessToken = config?.pancakeAccessToken
    ? decryptCredential(config.pancakeAccessToken)
    : process.env.PANCAKE_PAGE_ACCESS_TOKEN;
  const templateId = config?.pancakeTemplateId ?? process.env.PANCAKE_TEMPLATE_ID;
  if (!pageId || !pageAccessToken || !templateId) {
    throw new Error("Faltan PANCAKE_PAGE_ID, PANCAKE_PAGE_ACCESS_TOKEN o PANCAKE_TEMPLATE_ID");
  }
  if (!cart.phoneNormalized) throw new Error("El carrito no tiene un teléfono válido");

  const phone = cart.phoneNormalized.replace(/\D/g, "");
  const conversationId = `${pageId}_${phone}`;
  const endpoint = config?.pancakeEndpoint
    ?? process.env.PANCAKE_SEND_URL
    ?? `https://pages.fm/api/public_api/v1/pages/${encodeURIComponent(pageId)}/conversations/${encodeURIComponent(conversationId)}/messages`;
  const url = new URL(endpoint);
  url.searchParams.set("page_access_token", pageAccessToken);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "reply_inbox",
      conversation_id: conversationId,
      template_id: templateId,
        template_params: {
          BODY_PARAMS: {
          "1": recoveryUrl,
          },
        },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const responseText = await response.text();
  let responseBody: unknown = responseText;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    // Pancake can return a plain-text error from upstream providers.
  }
  if (!response.ok) throw new Error(`Pancake respondió ${response.status}: ${responseText.slice(0, 400)}`);

  const body = responseBody as { id?: string; message_id?: string };
  return {
    status: "SENT",
    providerId: body.id ?? body.message_id,
    response: responseBody,
  };
}
