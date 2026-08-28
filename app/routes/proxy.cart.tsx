import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { createCodOrder, upsertCart, type CartPayload } from "../services/cart.server";
import { ensureShopData } from "../services/bootstrap.server";
import db from "../db.server";
import { DEFAULT_FORM_BUILDER, DEFAULT_SALES_TOOLS, parseSettings } from "../services/app-settings.server";
import { clientIpAddress, hashClientIp, isIpPermanentlyBlocked } from "../services/fraud.server";
import { captureAttribution } from "../services/attribution.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return Response.json({ error: "App no instalada" }, { status: 401 });
  const config = await ensureShopData(session.shop);
  const blocked = await isIpPermanentlyBlocked(session.shop, hashClientIp(request.headers, session.shop));
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
    fraud: { blocked },
    coverage,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.public.appProxy(request);
    if (!session || !admin) return Response.json({ error: "App no instalada" }, { status: 401 });
    const config = await ensureShopData(session.shop);
    const body = (await request.json()) as { intent?: string; cart?: CartPayload; browserSessionId?: string; attribution?: unknown };
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
