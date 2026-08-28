import type { ActionFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { normalizeEcuadorPhone } from "../lib/domain";
import { authenticate } from "../shopify.server";

type OrderWebhook = {
  admin_graphql_api_id?: string;
  id?: number;
  phone?: string;
  email?: string;
  contact_email?: string;
  current_total_price?: string;
  total_price?: string;
  note_attributes?: Array<{ name: string; value: string }>;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const order = payload as OrderWebhook;
  const sessionId = order.note_attributes?.find((attribute) => attribute.name === "global_aura_session_id")?.value;
  const phone = normalizeEcuadorPhone(order.phone);
  const email = (order.email ?? order.contact_email)?.toLowerCase();
  const orderId = order.admin_graphql_api_id ?? (order.id ? `gid://shopify/Order/${order.id}` : undefined);
  const contactFilters: Prisma.CartSessionWhereInput[] = [];
  if (sessionId) contactFilters.push({ browserSessionId: sessionId });
  if (phone) contactFilters.push({ phoneNormalized: phone });
  if (email) contactFilters.push({ email });

  if (contactFilters.length) {
    await db.cartSession.updateMany({
      where: { shop, OR: contactFilters, status: { notIn: ["CANCELLED", "RECOVERED"] } },
      data: {
        status: "RECOVERED",
        recoveredAt: new Date(),
        sendAt: null,
        orderId,
        orderTotal: Number(order.current_total_price ?? order.total_price) || undefined,
      },
    });
  }
  return new Response();
};
