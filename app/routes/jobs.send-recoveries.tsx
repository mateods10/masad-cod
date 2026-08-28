import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { createAbandonedDraftOrder, hasMatchingOrder } from "../services/cart.server";
import { sendRecoveryViaPancake } from "../services/pancake.server";
import { isInsideSendWindow, nextAllowedSendAt } from "../lib/domain";

export const action = async ({ request }: ActionFunctionArgs) => {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || supplied !== expected) return Response.json({ error: "No autorizado" }, { status: 401 });

  const due = await db.cartSession.findMany({
    where: {
      status: "ACTIVE",
      consentWhatsapp: true,
      phoneNormalized: { not: null },
      messageSentAt: null,
      sendAt: { lte: new Date() },
    },
    orderBy: { sendAt: "asc" },
    take: 50,
  });
  const results: Array<{ id: string; status: string; error?: string }> = [];

  for (const cart of due) {
    const claim = await db.cartSession.updateMany({
      where: { id: cart.id, status: "ACTIVE", messageSentAt: null },
      data: { status: "SENDING" },
    });
    if (claim.count !== 1) continue;

    try {
      const config = await db.appConfig.findUnique({ where: { shop: cart.shop } });
      const now = new Date();
      if (!isInsideSendWindow(now, config?.sendStartHour ?? 8, config?.sendEndHour ?? 21)) {
        await db.cartSession.update({
          where: { id: cart.id },
          data: {
            status: "ACTIVE",
            sendAt: nextAllowedSendAt(now, 0, config?.sendStartHour ?? 8, config?.sendEndHour ?? 21),
          },
        });
        results.push({ id: cart.id, status: "RESCHEDULED_OUTSIDE_WINDOW" });
        continue;
      }

      const { admin } = await unauthenticated.admin(cart.shop);
      if (await hasMatchingOrder(admin, cart)) {
        await db.cartSession.update({
          where: { id: cart.id },
          data: { status: "RECOVERED", recoveredAt: new Date(), sendAt: null },
        });
        results.push({ id: cart.id, status: "SKIPPED_ORDER_EXISTS" });
        continue;
      }

      if (config?.pancakeDraftMode) {
        const draft = await createAbandonedDraftOrder(admin, cart);
        await db.$transaction([
          db.messageAttempt.create({
            data: {
              cartSessionId: cart.id,
              provider: "SHOPIFY_DRAFT",
              status: "DRAFTED",
              providerId: draft.id,
              responseJson: JSON.stringify({ draftOrderId: draft.id, draftOrderName: draft.name }),
            },
          }),
          db.cartSession.update({
            where: { id: cart.id },
            data: {
              status: "DRAFTED",
              draftOrderId: draft.id,
              draftOrderName: draft.name,
              draftedAt: new Date(),
              sendAt: null,
            },
          }),
        ]);
        results.push({ id: cart.id, status: "DRAFTED" });
        continue;
      }

      const sent = await sendRecoveryViaPancake(cart, config);
      await db.$transaction([
        db.messageAttempt.create({
          data: {
            cartSessionId: cart.id,
            status: sent.status,
            providerId: sent.providerId,
            responseJson: JSON.stringify(sent.response),
          },
        }),
        db.cartSession.update({
          where: { id: cart.id },
          data: { status: sent.status, messageSentAt: new Date(), sendAt: null },
        }),
      ]);
      results.push({ id: cart.id, status: sent.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      const failedCount = await db.messageAttempt.count({ where: { cartSessionId: cart.id, status: "FAILED" } });
      await db.$transaction([
        db.messageAttempt.create({ data: { cartSessionId: cart.id, status: "FAILED", error: message.slice(0, 1000) } }),
        db.cartSession.update({
          where: { id: cart.id },
          data: {
            status: failedCount >= 2 ? "FAILED" : "ACTIVE",
            sendAt: failedCount >= 2 ? null : new Date(Date.now() + 30 * 60 * 1000),
          },
        }),
      ]);
      results.push({ id: cart.id, status: "FAILED", error: message });
    }
  }

  return Response.json({ processed: results.length, results });
};
