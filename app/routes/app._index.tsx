import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureShopData } from "../services/bootstrap.server";
import { encryptCredential } from "../services/credentials.server";
import { createAbandonedDraftOrder } from "../services/cart.server";
import { normalizeEcuadorPhone } from "../lib/domain";
import { sendRecoveryViaPancake } from "../services/pancake.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const config = await ensureShopData(session.shop);
  const [active, sent, recovered, risky, drafted, blockedIps, customerBlocks, completedRows, recent] = await Promise.all([
    db.cartSession.count({ where: { shop: session.shop, status: "ACTIVE" } }),
    db.cartSession.count({ where: { shop: session.shop, messageSentAt: { not: null } } }),
    db.cartSession.count({ where: { shop: session.shop, status: "RECOVERED" } }),
    db.cartSession.count({ where: { shop: session.shop, riskScore: { gte: 25 } } }),
    db.cartSession.count({ where: { shop: session.shop, draftedAt: { not: null }, orderId: null } }),
    db.fraudIpBlock.count({ where: { shop: session.shop } }),
    db.customerFraudBlock.findMany({
      where: { shop: session.shop, active: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, customerName: true, phoneNormalized: true, reason: true, updatedAt: true },
    }),
    db.cartSession.findMany({
      where: { shop: session.shop, orderId: { not: null }, status: { in: ["ORDERED", "RECOVERED"] } },
      select: { orderId: true, orderTotal: true, subtotal: true, shippingMethod: true },
    }),
    db.cartSession.findMany({ where: { shop: session.shop }, orderBy: { updatedAt: "desc" }, take: 10 }),
  ]);
  const completedOrders = new Map<string, { subtotal: number; shippingMethod: string }>();
  for (const row of completedRows) {
    if (!row.orderId) continue;
    const current = completedOrders.get(row.orderId);
    const value = row.orderTotal == null
      ? Number(row.subtotal) + (row.shippingMethod === "PRIORITY" ? Number(config.priorityFee) : 0)
      : Number(row.orderTotal);
    if (!current || value > current.subtotal) completedOrders.set(row.orderId, { subtotal: value, shippingMethod: row.shippingMethod });
  }
  const completedRevenue = [...completedOrders.values()].reduce(
    (total, order) => total + order.subtotal,
    0,
  );
  const updatedAtFormatter = new Intl.DateTimeFormat("es-EC", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Guayaquil",
  });
  return {
    shop: session.shop,
    config: {
      delayHours: config.delayHours,
      sendStartHour: config.sendStartHour,
      sendEndHour: config.sendEndHour,
      priorityFee: Number(config.priorityFee),
      riskMaxQuantity: config.riskMaxQuantity,
      riskMaxOrderValue: Number(config.riskMaxOrderValue),
      sectorFieldEnabled: config.sectorFieldEnabled,
      formEnabled: config.formEnabled,
      pancakeMode: config.pancakeMode,
      pancakePageId: config.pancakePageId ?? "",
      pancakeTemplateId: config.pancakeTemplateId ?? "",
      pancakeTokenSaved: Boolean(config.pancakeAccessToken),
      pancakeDraftMode: config.pancakeDraftMode,
    },
    stats: { active, sent, recovered, risky, drafted, blockedIps, customerBlocks: customerBlocks.length, completed: completedOrders.size, completedRevenue },
    customerBlocks: customerBlocks.map((block) => ({
      ...block,
      updatedAtLabel: updatedAtFormatter.format(block.updatedAt),
    })),
    recent: recent.map((cart) => ({
      id: cart.id,
      name: cart.fullName ?? "Sin nombre",
      phone: cart.phone ?? "—",
      status: cart.status,
      subtotal: Number(cart.subtotal),
      riskScore: cart.riskScore,
      updatedAtLabel: updatedAtFormatter.format(cart.updatedAt),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const current = await ensureShopData(session.shop);
  if (form.get("intent") === "toggle-form") {
    const formEnabled = !current.formEnabled;
    await db.appConfig.update({ where: { shop: session.shop }, data: { formEnabled } });
    return {
      ok: true,
      message: formEnabled
        ? "El formulario quedó habilitado en esta tienda."
      : "El formulario quedó deshabilitado en esta tienda.",
    };
  }
  if (form.get("intent") === "block-customer") {
    const phoneNormalized = normalizeEcuadorPhone(String(form.get("blockedPhone") ?? ""));
    if (!phoneNormalized) {
      return Response.json({ ok: false, error: "Ingresa un celular ecuatoriano válido para bloquear a la clienta." }, { status: 400 });
    }
    const customerName = String(form.get("blockedCustomerName") ?? "").trim().replace(/\s+/g, " ").slice(0, 120) || null;
    const reason = String(form.get("blockedCustomerReason") ?? "").trim().replace(/\s+/g, " ").slice(0, 300) || null;
    await db.customerFraudBlock.upsert({
      where: { shop_phoneNormalized: { shop: session.shop, phoneNormalized } },
      create: { shop: session.shop, phoneNormalized, customerName, reason, active: true },
      update: { customerName, reason, active: true },
    });
    return { ok: true, message: `${phoneNormalized} quedó bloqueado manualmente para pedidos COD.` };
  }
  if (form.get("intent") === "unblock-customer") {
    const id = String(form.get("customerBlockId") ?? "");
    const block = await db.customerFraudBlock.findFirst({ where: { id, shop: session.shop, active: true } });
    if (!block) return Response.json({ ok: false, error: "No se encontró el bloqueo indicado." }, { status: 404 });
    await db.customerFraudBlock.update({ where: { id }, data: { active: false } });
    return { ok: true, message: `${block.phoneNormalized} ya puede volver a realizar pedidos COD.` };
  }
  if (form.get("intent") === "disconnect-pancake") {
    await db.appConfig.update({
      where: { shop: session.shop },
      data: {
        pancakeMode: "mock",
        pancakeEndpoint: null,
        pancakePageId: null,
        pancakeAccessToken: null,
        pancakeTemplateName: null,
        pancakeTemplateId: null,
        pancakeTemplateLang: "es",
      },
    });
    return { ok: true, message: "Pancake fue desvinculado de esta tienda." };
  }
  if (form.get("intent") === "send-test-recovery") {
    const phone = String(form.get("testPhone") ?? "").trim();
    const phoneNormalized = normalizeEcuadorPhone(phone);
    if (!phoneNormalized) {
      return Response.json({ ok: false, error: "Ingresa un celular ecuatoriano válido para la prueba." }, { status: 400 });
    }
    if (!current.pancakePageId || !current.pancakeAccessToken || !current.pancakeTemplateId) {
      return Response.json({ ok: false, error: "Primero guarda el canal, token y plantilla de Pancake." }, { status: 400 });
    }

    const productsResponse = await admin.graphql(
      `#graphql
        query MasadTestProduct {
          products(first: 1, query: "status:active") {
            nodes {
              title
              variants(first: 1) { nodes { id title price } }
            }
          }
        }`,
    );
    const productsBody = await productsResponse.json() as {
      data?: { products?: { nodes?: Array<{ title: string; variants: { nodes: Array<{ id: string; title: string; price: string }> } }> } };
    };
    const product = productsBody.data?.products?.nodes?.find((item) => item.variants.nodes.length);
    const variant = product?.variants.nodes[0];
    if (!product || !variant) {
      return Response.json({ ok: false, error: "No se encontró un producto activo para crear el borrador de prueba." }, { status: 400 });
    }

    const cart = await db.cartSession.create({
      data: {
        shop: session.shop,
        browserSessionId: `test-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: "SENDING",
        fullName: "Prueba de recuperación",
        phone,
        phoneNormalized,
        consentWhatsapp: true,
        consentAt: new Date(),
        subtotal: Number(variant.price),
        linesJson: JSON.stringify([{
          variantId: variant.id,
          quantity: 1,
          productTitle: product.title,
          title: product.title,
          variantTitle: variant.title,
          price: Number(variant.price),
          unitPrice: Number(variant.price),
          properties: [],
        }]),
      },
    });

    try {
      const draft = await createAbandonedDraftOrder(admin, cart);
      const sent = await sendRecoveryViaPancake(cart, { ...current, pancakeMode: "api" });
      await db.$transaction([
        db.messageAttempt.create({
          data: {
            cartSessionId: cart.id,
            provider: "PANCAKE_TEST",
            status: sent.status,
            providerId: sent.providerId,
            responseJson: JSON.stringify(sent.response),
          },
        }),
        db.cartSession.update({
          where: { id: cart.id },
          data: {
            status: sent.status,
            draftOrderId: draft.id,
            draftOrderName: draft.name,
            draftedAt: new Date(),
            messageSentAt: new Date(),
          },
        }),
      ]);
      return { ok: true, message: `Prueba enviada. Se creó el borrador ${draft.name} y Pancake aceptó la plantilla para ${phoneNormalized}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo completar la prueba";
      await db.$transaction([
        db.messageAttempt.create({ data: { cartSessionId: cart.id, provider: "PANCAKE_TEST", status: "FAILED", error: message.slice(0, 1000) } }),
        db.cartSession.update({ where: { id: cart.id }, data: { status: "FAILED" } }),
      ]);
      return Response.json({ ok: false, error: `La prueba no se pudo enviar: ${message}` }, { status: 400 });
    }
  }
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(form.get(name));
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  };
  const money = (name: string, fallback: number) => {
    const value = Number(form.get(name));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const text = (name: string, max = 300) => String(form.get(name) ?? "").trim().slice(0, max);
  const pancakePageId = text("pancakePageId", 160);
  const pancakeTemplateId = text("pancakeTemplateId", 200);
  const pancakeToken = text("pancakeAccessToken", 4000);
  const pancakeAccessToken = pancakeToken ? encryptCredential(pancakeToken) : current.pancakeAccessToken;
  const pancakeEnabled = form.get("pancakeEnabled") === "on";
  if (pancakeEnabled && (!pancakePageId || !pancakeAccessToken || !pancakeTemplateId)) {
    return Response.json({
      ok: false,
      error: "Para activar Pancake completa el ID del canal, el token y el ID de la plantilla aprobada.",
    }, { status: 400 });
  }

  await db.appConfig.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop },
    update: {
      delayHours: integer("delayHours", 12, 1, 72),
      sendStartHour: integer("sendStartHour", 8, 0, 23),
      sendEndHour: integer("sendEndHour", 21, 0, 23),
      priorityFee: money("priorityFee", 2.5),
      riskMaxQuantity: integer("riskMaxQuantity", 5, 1, 100),
      riskMaxOrderValue: money("riskMaxOrderValue", 80),
      sectorFieldEnabled: form.get("sectorFieldEnabled") === "on",
      pancakeMode: pancakeEnabled ? "api" : "mock",
      pancakeEndpoint: null,
      pancakePageId: pancakePageId || null,
      pancakeAccessToken,
      pancakeTemplateName: null,
      pancakeTemplateId: pancakeTemplateId || null,
      pancakeTemplateLang: "es",
      pancakeDraftMode: form.get("pancakeDraftMode") === "on",
    },
  });
  return {
    ok: true,
    message: pancakeEnabled
      ? "Configuración guardada. Pancake quedó activo para los carritos abandonados."
      : "Configuración guardada. Pancake permanece en simulación.",
  };
};

const cardStyle = { border: "1px solid #dfe3e8", borderRadius: 12, padding: 16, background: "#fff" } as const;

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData() as { ok?: boolean; error?: string; message?: string } | undefined;
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  return (
    <s-page heading="Masad COD · Recuperación de carritos">
      <s-section heading="Estado general">
        <div style={{ ...cardStyle, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", padding: 0, marginBottom: 14, overflow: "hidden" }}>
          <div style={{ padding: "18px 24px", textAlign: "center", borderRight: "1px solid #dfe3e8" }}>
            <small style={{ color: "#616a75" }}>Pedidos completados</small>
            <div style={{ fontSize: 30, fontWeight: 800, marginTop: 6 }}>{data.stats.completed}</div>
          </div>
          <div style={{ padding: "18px 24px", textAlign: "center" }}>
            <small style={{ color: "#616a75" }}>Recaudo generado</small>
            <div style={{ fontSize: 30, fontWeight: 800, marginTop: 6 }}>${data.stats.completedRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <div style={cardStyle}><small>Carritos activos</small><div style={{ fontSize: 28, fontWeight: 700 }}>{data.stats.active}</div></div>
          <div style={cardStyle}><small>Mensajes enviados</small><div style={{ fontSize: 28, fontWeight: 700 }}>{data.stats.sent}</div></div>
          <div style={cardStyle}><small>Recuperados</small><div style={{ fontSize: 28, fontWeight: 700 }}>{data.stats.recovered}</div></div>
          <div style={cardStyle}><small>Con alerta de riesgo</small><div style={{ fontSize: 28, fontWeight: 700 }}>{data.stats.risky}</div></div>
          <div style={{ ...cardStyle, borderColor: "#f1b5ae", background: "#fff7f6" }}><small>IP bloqueadas por fraude</small><div style={{ fontSize: 28, fontWeight: 700, color: "#b42318" }}>{data.stats.blockedIps}</div></div>
          <div style={cardStyle}><small>Borradores</small><div style={{ fontSize: 28, fontWeight: 700 }}>{data.stats.drafted}</div></div>
        </div>
      </s-section>

      <s-section heading="Visibilidad">
        <Form method="post">
          <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>
                El formulario de Masad COD está{" "}
                <span style={{ display: "inline-block", marginLeft: 6, padding: "4px 9px", borderRadius: 999, background: data.config.formEnabled ? "#008060" : "#6d7175", color: "#fff", fontSize: 13 }}>
                  {data.config.formEnabled ? "habilitado" : "deshabilitado"}
                </span>
              </div>
              <p style={{ margin: "7px 0 0", color: "#616a75" }}>
                {data.config.formEnabled
                  ? "El botón PAGA AL RECIBIR y el formulario se muestran en los productos de esta tienda."
                  : "El botón y el formulario están ocultos; la app y su configuración permanecen instaladas."}
              </p>
            </div>
            <button
              type="submit"
              name="intent"
              value="toggle-form"
              style={{ border: `1px solid ${data.config.formEnabled ? "#c5281c" : "#087ec4"}`, borderRadius: 8, padding: "9px 15px", background: data.config.formEnabled ? "#fff" : "#087ec4", color: data.config.formEnabled ? "#c5281c" : "#fff", fontWeight: 800, cursor: "pointer" }}
            >
              {data.config.formEnabled ? "Desactivar" : "Activar"}
            </button>
          </div>
        </Form>
      </s-section>

      <s-section heading="Bloqueo manual de clientas">
        <div style={{ ...cardStyle, borderColor: "#f1b5ae", background: "#fffafa" }}>
          <p style={{ marginTop: 0, color: "#5a2420" }}>
            Bloquea un celular de forma permanente. La clienta no podrá crear pedidos COD mediante Masad hasta que la desbloquees aquí.
          </p>
          <Form method="post" className="ga-admin-grid">
            <label>Nombre o referencia<input name="blockedCustomerName" maxLength={120} placeholder="Ej.: María Pérez" /></label>
            <label>Celular a bloquear<input name="blockedPhone" type="tel" inputMode="numeric" required placeholder="0995393511" /></label>
            <label>Motivo (opcional)<input name="blockedCustomerReason" maxLength={300} placeholder="Ej.: pedidos falsos repetidos" /></label>
            <div style={{ display: "flex", alignItems: "end" }}><button type="submit" name="intent" value="block-customer" style={{ border: 0, borderRadius: 8, padding: "10px 14px", background: "#b42318", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Bloquear clienta</button></div>
          </Form>
        </div>
        <div style={{ ...cardStyle, marginTop: 14 }}>
          <strong>Clientas bloqueadas manualmente: {data.stats.customerBlocks}</strong>
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table className="ga-admin-table">
              <thead><tr><th>Clienta</th><th>Celular</th><th>Motivo</th><th>Bloqueada</th><th></th></tr></thead>
              <tbody>
                {data.customerBlocks.map((block) => (
                  <tr key={block.id}>
                    <td>{block.customerName ?? "Sin nombre"}</td><td>{block.phoneNormalized}</td><td>{block.reason ?? "—"}</td><td>{block.updatedAtLabel}</td>
                    <td><Form method="post"><input type="hidden" name="customerBlockId" value={block.id} /><button type="submit" name="intent" value="unblock-customer" style={{ border: "1px solid #087ec4", borderRadius: 7, padding: "7px 10px", background: "#fff", color: "#075985", fontWeight: 700, cursor: "pointer" }}>Desbloquear</button></Form></td>
                  </tr>
                ))}
                {!data.customerBlocks.length && <tr><td colSpan={5}>No hay clientas bloqueadas manualmente.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </s-section>

      <s-section heading="Configuración">
        <Form method="post">
          <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: "#eef7ff", color: "#143a52" }}>
            Los pedidos siguen entrando las 24 horas. Este horario controla únicamente cuándo se envían los WhatsApp de recuperación.
          </div>
          <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: "#fff7f6", color: "#8a1c14" }}>
            Protección antifraude activa: al tercer intento de pedido COD desde la misma IP dentro de 24 horas, la IP queda bloqueada permanentemente. La app conserva solo un hash de la IP.
          </div>
          {actionData && "error" in actionData && actionData.error && (
            <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: "#fff1f0", color: "#8e1b14" }}>{actionData.error}</div>
          )}
          {actionData && "message" in actionData && actionData.message && (
            <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: "#effaf3", color: "#176b35" }}>{actionData.message}</div>
          )}
          <div className="ga-admin-grid">
            <label>Horas antes de recuperar<input name="delayHours" type="number" min="1" max="72" defaultValue={data.config.delayHours} /></label>
            <label>Inicio de WhatsApp<input name="sendStartHour" type="number" min="0" max="23" defaultValue={data.config.sendStartHour} /></label>
            <label>Fin de WhatsApp<input name="sendEndHour" type="number" min="0" max="23" defaultValue={data.config.sendEndHour} /></label>
            <label>Envío prioritario (USD)<input name="priorityFee" type="number" min="0" step="0.01" defaultValue={data.config.priorityFee} /></label>
            <label>Máximo por producto<input name="riskMaxQuantity" type="number" min="1" defaultValue={data.config.riskMaxQuantity} /></label>
            <label>Valor de alerta (USD)<input name="riskMaxOrderValue" type="number" min="0" step="0.01" defaultValue={data.config.riskMaxOrderValue} /></label>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
            <input name="sectorFieldEnabled" type="checkbox" defaultChecked={data.config.sectorFieldEnabled} /> Mostrar el campo Sector o barrio
          </label>
          <div style={{ ...cardStyle, marginTop: 18, background: "#f7fbff", borderColor: "#b8d9ef" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontWeight: 800 }}>
              <input name="pancakeDraftMode" type="checkbox" defaultChecked={data.config.pancakeDraftMode} style={{ marginTop: 3 }} />
              <span>
                Crear carritos abandonados como borradores
                <small style={{ display: "block", marginTop: 6, color: "#4f5f6f", fontWeight: 400, lineHeight: 1.45 }}>
                  Después de {data.config.delayHours} horas, Shopify crea únicamente un borrador con la etiqueta CARRITO_ABANDONADO. PosCake/Pancake puede sincronizarlo y usarlo para iniciar el flujo de WhatsApp. Al activar este modo, la plantilla se controla desde Pancake y la app no envía un segundo mensaje directo.
                </small>
              </span>
            </label>
          </div>
          <div style={{ marginTop: 16 }}><s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>Guardar configuración</s-button></div>

          <div style={{ ...cardStyle, marginTop: 24 }}>
            <h2 style={{ margin: "0 0 6px" }}>Conectar Pancake</h2>
            <p style={{ margin: "0 0 16px", color: "#616a75" }}>
              Vincula una cuenta existente únicamente para enviar WhatsApp de carritos abandonados. Los pedidos normales continúan llegando a PosCake como hasta ahora.
            </p>
            <div style={{ marginBottom: 14, fontWeight: 700, color: data.config.pancakeMode === "api" ? "#176b35" : "#616a75" }}>
              Estado: {data.config.pancakeMode === "api" ? "Conectado y activo" : data.config.pancakeTokenSaved ? "Credenciales guardadas, envío desactivado" : "Sin conectar"}
            </div>
            <div className="ga-admin-grid">
              <label>ID del canal de WhatsApp<input name="pancakePageId" placeholder="waba_..." defaultValue={data.config.pancakePageId} /></label>
              <label>Token de acceso<input name="pancakeAccessToken" type="password" autoComplete="new-password" placeholder={data.config.pancakeTokenSaved ? "Token guardado; déjalo vacío para conservarlo" : "Pega el token de Pancake"} /></label>
              <label>ID de la plantilla aprobada<input name="pancakeTemplateId" placeholder="ID numérico de Meta/Pancake" defaultValue={data.config.pancakeTemplateId} /></label>
            </div>
            <p style={{ margin: "12px 0 0", color: "#616a75", fontSize: 13 }}>
              La plantilla debe incluir la variable <code>{"{{1}}"}</code>; Masad insertará allí el enlace personal para restaurar el carrito.
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
              <input name="pancakeEnabled" type="checkbox" defaultChecked={data.config.pancakeMode === "api"} /> Activar envío real de recuperaciones por Pancake
            </label>
            {data.config.pancakeTokenSaved && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="submit"
                  name="intent"
                  value="disconnect-pancake"
                  style={{ border: "1px solid #c5281c", borderRadius: 8, padding: "8px 12px", background: "#fff", color: "#c5281c", fontWeight: 700, cursor: "pointer" }}
                >
                  Desvincular Pancake
                </button>
              </div>
            )}
          </div>
        </Form>
      </s-section>

      <s-section heading="Actividad reciente">
        <div style={{ overflowX: "auto" }}>
          <table className="ga-admin-table">
            <thead><tr><th>Cliente</th><th>Celular</th><th>Estado</th><th>Total</th><th>Riesgo</th><th>Actualizado</th></tr></thead>
            <tbody>
              {data.recent.map((cart) => (
                <tr key={cart.id}><td>{cart.name}</td><td>{cart.phone}</td><td>{cart.status}</td><td>${cart.subtotal.toFixed(2)}</td><td>{cart.riskScore}/100</td><td>{cart.updatedAtLabel}</td></tr>
              ))}
              {!data.recent.length && <tr><td colSpan={6}>Todavía no hay carritos registrados.</td></tr>}
            </tbody>
          </table>
        </div>
      </s-section>

      <s-section heading="Prueba de carrito abandonado">
        <div style={cardStyle}>
          <p style={{ marginTop: 0, color: "#4f5f6f" }}>
            Crea un borrador real con un producto activo y envía una sola plantilla de prueba. No modifica la automatización normal ni PosCake.
          </p>
          <Form method="post" style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <label style={{ minWidth: 240 }}>Celular de prueba<input name="testPhone" type="tel" inputMode="numeric" defaultValue="0998483960" /></label>
            <button type="submit" name="intent" value="send-test-recovery" style={{ border: 0, borderRadius: 8, padding: "10px 14px", background: "#087ec4", color: "#fff", fontWeight: 800, cursor: "pointer" }}>
              Crear borrador y enviar prueba
            </button>
          </Form>
        </div>
      </s-section>

      <s-section slot="aside" heading="Tienda">
        <s-paragraph>{data.shop}</s-paragraph>
        <s-paragraph>Pedidos: disponibles 24 horas.</s-paragraph>
        <s-paragraph>WhatsApp: {String(data.config.sendStartHour).padStart(2, "0")}:00–{String(data.config.sendEndHour).padStart(2, "0")}:00, Ecuador.</s-paragraph>
        <s-paragraph>PosCake continúa recibiendo los pedidos terminados desde Shopify.</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
