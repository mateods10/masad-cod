import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import type { CartLine } from "../lib/domain";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session || !params.token) return new Response("Enlace inválido", { status: 400 });
  const cart = await db.cartSession.findFirst({
    where: { shop: session.shop, recoveryToken: params.token },
  });
  if (!cart) return new Response("Este carrito ya no está disponible", { status: 404 });

  const lines = JSON.parse(cart.linesJson) as CartLine[];
  const permalinkLines = lines
    .map((line) => `${line.variantId.split("/").at(-1)}:${line.quantity}`)
    .join(",");
  if (!permalinkLines) return new Response("El carrito está vacío", { status: 410 });

  await db.cartSession.update({
    where: { id: cart.id },
    data: { status: cart.status === "ORDERED" ? "ORDERED" : "CLICKED", clickedAt: new Date() },
  });

  const redirect = new URL(`https://${session.shop}/cart/${permalinkLines}`);
  redirect.searchParams.set("storefront", "true");
  redirect.searchParams.set("attributes[global_aura_session_id]", cart.browserSessionId);
  const firstLineProperties = Object.fromEntries(
    (lines[0]?.properties ?? []).map((property) => [property.name, property.value]),
  );
  if (Object.keys(firstLineProperties).length) {
    redirect.searchParams.set(
      "properties",
      Buffer.from(JSON.stringify(firstLineProperties)).toString("base64url"),
    );
  }
  return new Response(null, { status: 302, headers: { location: redirect.toString() } });
};
