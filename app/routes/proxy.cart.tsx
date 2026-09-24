import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { createCodOrder, upsertCart, type CartPayload } from "../services/cart.server";
import { ensureShopData } from "../services/bootstrap.server";
import db from "../db.server";
import { DEFAULT_FORM_BUILDER, DEFAULT_SALES_TOOLS, parseSettings } from "../services/app-settings.server";
import { clientIpAddress, hashClientIp } from "../services/fraud.server";
import { captureAttribution } from "../services/attribution.server";
import { quoteUpsells } from "../services/upsells.server";
import { acceptPostUpsell, postCart, postUpsellToken } from "../services/post-upsells.server";
import { confirmationToken, getWhatsappConfirmation, whatsappSettings } from "../services/whatsapp-confirmation.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return Response.json({ error: "App no instalada" }, { status: 401 });
  const config = await ensureShopData(session.shop);
  const coverage = await db.coverageRule.findMany({
      where: { shop: session.shop, active: true },
      orderBy: [{ province: "asc" }, { city: "asc" }],
      select: { province: true, city: true, coverageType: true },
    });
  return Response.json({
    config: {
      formEnabled: config.formEnabled,
      priorityFee: Number(config.priorityFee),
      sectorFieldEnabled: config.sectorFieldEnabled,
      delayHours: config.delayHours,
      formBuilder: parseSettings(config.formBuilderJson, DEFAULT_FORM_BUILDER),
      salesTools: parseSettings(config.salesToolsJson, DEFAULT_SALES_TOOLS),
    },
    fraud: { blocked: false },
    coverage,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.public.appProxy(request);
    if (!session || !admin) return Response.json({ error: "App no instalada" }, { status: 401 });
    const config = await ensureShopData(session.shop);
    const body = (await request.json()) as { intent?: string; cart?: CartPayload; browserSessionId?: string; attribution?: unknown; token?: string; campaignId?: string; offerId?: string; expectedPrice?: number };
    if (body.intent === "whatsapp-confirmation") {
      return Response.json(await getWhatsappConfirmation(session.shop, admin, config.integrationsJson, body.token || ""), { headers: { "Cache-Control": "no-store" } });
    }
    if (body.intent === "quote-upsells") {
      const offers = await quoteUpsells(admin, config.salesToolsJson, body.cart?.lines || []);
      return Response.json({ offers }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.intent === "post-upsells" || body.intent === "accept-post-upsell") {
      if (!session.scope?.split(",").includes("write_order_edits")) return Response.json({ offers: [], error: "La tienda todavía no habilitó las ofertas post-compra." }, { status: 403 });
      if (body.intent === "accept-post-upsell") {
        return Response.json(await acceptPostUpsell(session.shop, admin, config.salesToolsJson, { token: body.token || "", campaignId: body.campaignId || "", offerId: body.offerId || "", expectedPrice: Number(body.expectedPrice) }));
      }
      const cart = await postCart(session.shop, body.token || "");
      const accepted = await db.upsellAcceptance.findMany({ where: { shop: session.shop, orderId: cart.orderId! }, select: { campaignId: true, offerId: true } });
      const offers = (await quoteUpsells(admin, config.salesToolsJson, JSON.parse(cart.linesJson), "POST")).filter(o => !accepted.some(a => a.campaignId === o.campaignId && a.offerId === o.id));
      return Response.json({ offers }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.intent === "capture-attribution") {
      if (!body.browserSessionId || body.browserSessionId.length > 120) {
        return Response.json({ error: "Sesión de atribución inválida" }, { status: 400 });
      }
      await captureAttribution(session.shop, body.browserSessionId, body.attribution);
      return Response.json({ ok: true });
    }
    if (!config.formEnabled && body.intent !== "place-cod") {
      return Response.json({ error: "El formulario está deshabilitado" }, { status: 403 });
    }
    if (!body.cart?.browserSessionId || body.cart.browserSessionId.length > 120) {
      return Response.json({ error: "Sesión de carrito inválida" }, { status: 400 });
    }

    if (body.intent === "place-cod") {
      if (body.cart.consentWhatsapp !== true) throw new Error("Acepta la confirmación y los mensajes relacionados con tu compra para continuar.");
      const result = await createCodOrder(
        session.shop,
        admin,
        body.cart,
        hashClientIp(request.headers, session.shop),
        {
          clientIp: clientIpAddress(request.headers),
          userAgent: request.headers.get("user-agent"),
          cookieHeader: request.headers.get("cookie"),
        },
      );
      return Response.json({
        ok: true,
        orderId: result.orderId,
        orderName: result.orderName,
        duplicate: result.duplicate,
        orderTotal: Number(result.cart.orderTotal),
        whatsappConfirmationToken: whatsappSettings(config.integrationsJson).enabled && result.cart.consentWhatsapp ? confirmationToken(session.shop, result.cart.id) : null,
        postUpsellToken: session.scope?.split(",").includes("write_order_edits") ? postUpsellToken(session.shop, result.cart.id) : null,
      });
    }

    const result = await upsertCart(session.shop, admin, body.cart);
    return Response.json({
      ok: true,
      recoveryEligible: Boolean(result.cart.sendAt),
      sendAt: result.cart.sendAt,
      subtotal: Number(result.cart.subtotal),
      shippingMethod: result.shippingMethod,
      agencyRecommended: result.analysis.zone.type !== "NONE",
      agencyRequired: false,
      zoneWarning: result.analysis.zone.type !== "NONE",
      risk: result.analysis.risk,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar el carrito";
    return Response.json({ error: message }, { status: 400 });
  }
};
