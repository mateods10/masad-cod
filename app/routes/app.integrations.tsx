import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureShopData } from "../services/bootstrap.server";
import { DEFAULT_INTEGRATIONS, parseSettings, type IntegrationSettings } from "../services/app-settings.server";

const card = { border: "1px solid #dfe3e8", borderRadius: 14, padding: 18, background: "#fff" } as const;
export const loader = async ({ request }: LoaderFunctionArgs) => { const { session } = await authenticate.admin(request); const config = await ensureShopData(session.shop); return { settings: parseSettings(config.integrationsJson, DEFAULT_INTEGRATIONS), pancakeConnected: config.pancakeMode === "api" || config.pancakeDraftMode }; };
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request); const form = await request.formData();
  const webhook = String(form.get("googleSheetsWebhook") ?? "").trim().slice(0, 500); const apiKey = String(form.get("googlePlacesApiKey") ?? "").trim().slice(0, 300);
  if (webhook && !/^https:\/\//i.test(webhook)) return Response.json({ ok: false, error: "La URL de Google Sheets debe comenzar con https://" }, { status: 400 });
  const settings: IntegrationSettings = { googleSheetsEnabled: form.get("googleSheetsEnabled") === "on", googleSheetsWebhook: webhook, googlePlacesEnabled: form.get("googlePlacesEnabled") === "on", googlePlacesApiKey: apiKey };
  await db.appConfig.update({ where: { shop: session.shop }, data: { integrationsJson: JSON.stringify(settings) } }); return { ok: true, message: "Integraciones guardadas." };
};
export default function Integrations() { const data = useLoaderData<typeof loader>(); const result = useActionData() as { ok?: boolean; error?: string; message?: string } | undefined; const nav = useNavigation(); return <s-page heading="Integraciones"><s-section>
  {result && !result.ok && <p className="ga-form-error">{result.error}</p>}{result?.ok && <p style={{ padding: 12, background: "#effaf3", color: "#176b35", borderRadius: 10 }}>✓ {result.message}</p>}
  <div style={{ display: "grid", gap: 14 }}>
    <div style={card}><h2 style={{ marginTop: 0 }}>💬 Mensajes WhatsApp y Pancake</h2><p>Los borradores de carritos abandonados pueden entrar a Pancake sin interferir con los pedidos terminados que ya sincroniza PosCake.</p><strong style={{ color: data.pancakeConnected ? "#176b35" : "#616a75" }}>{data.pancakeConnected ? "Conexión o modo borrador configurado" : "Pendiente de configurar"}</strong><div style={{ marginTop: 12 }}><s-button href="/app">Configurar Pancake</s-button></div></div>
    <Form method="post"><div style={{ display: "grid", gap: 14 }}>
      <div style={card}><h2 style={{ marginTop: 0 }}>▦ Google Sheets</h2><p>Guarda una conexión para enviar los datos de pedidos a una hoja mediante Apps Script o webhook.</p><label style={{ display: "flex", gap: 8, fontWeight: 700 }}><input type="checkbox" name="googleSheetsEnabled" defaultChecked={data.settings.googleSheetsEnabled} /> Activar Google Sheets</label><label style={{ display: "grid", gap: 6, marginTop: 12, fontWeight: 700 }}>URL del webhook<input name="googleSheetsWebhook" type="url" defaultValue={data.settings.googleSheetsWebhook} placeholder="https://script.google.com/macros/s/.../exec" /></label></div>
      <div style={card}><h2 style={{ marginTop: 0 }}>📍 Autocompletado de direcciones de Google</h2><p>Guarda la clave de Google Places para preparar el autocompletado de direcciones y reducir errores de entrega.</p><label style={{ display: "flex", gap: 8, fontWeight: 700 }}><input type="checkbox" name="googlePlacesEnabled" defaultChecked={data.settings.googlePlacesEnabled} /> Activar Google Places</label><label style={{ display: "grid", gap: 6, marginTop: 12, fontWeight: 700 }}>Clave API<input name="googlePlacesApiKey" type="password" defaultValue={data.settings.googlePlacesApiKey} autoComplete="new-password" placeholder="AIza..." /></label></div>
      <div><s-button type="submit" variant="primary" {...(nav.state === "submitting" ? { loading: true } : {})}>Guardar integraciones</s-button></div>
    </div></Form>
    <div style={card}><h2 style={{ marginTop: 0 }}>◎ Píxeles de Meta y TikTok</h2><p>Administra IDs y eventos de seguimiento de forma manual.</p><s-button href="/app/pixels">Abrir píxeles</s-button></div>
  </div>
  </s-section></s-page>; }
