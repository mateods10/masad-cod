import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import type { TrackingPixel } from "@prisma/client";

import db from "../db.server";
import { encryptCredential } from "../services/credentials.server";
import { authenticate } from "../shopify.server";
import { sendConversionTest } from "../services/conversion-api.server";

const PLATFORM_LABELS: Record<string, string> = {
  META: "Meta Conversions API",
  TIKTOK: "TikTok Events API",
};

type PixelView = Omit<TrackingPixel, "apiToken"> & { tokenSaved: boolean };

function isChecked(form: FormData, field: string) {
  return form.get(field) === "on";
}

function validatePixelId(platform: string, pixelId: string) {
  if (platform === "META") return /^\d{8,25}$/.test(pixelId);
  if (platform === "TIKTOK") return /^[A-Za-z0-9_-]{8,64}$/.test(pixelId);
  return false;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const records = await db.trackingPixel.findMany({
    where: { shop: session.shop },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
  const pixels: PixelView[] = records.map(({ apiToken, ...pixel }) => ({ ...pixel, tokenSaved: Boolean(apiToken) }));
  return { pixels };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "add");
  const id = String(form.get("id") ?? "");

  if (intent === "delete") {
    await db.trackingPixel.deleteMany({ where: { id, shop: session.shop } });
    return { ok: true, message: "Integración eliminada" };
  }

  if (intent === "toggle") {
    const pixel = await db.trackingPixel.findFirst({ where: { id, shop: session.shop } });
    if (pixel) await db.trackingPixel.update({ where: { id }, data: { active: !pixel.active } });
    return { ok: true, message: pixel?.active ? "Integración desactivada" : "Integración activada" };
  }

  if (form.get("testConnection") === "1") {
    const pixel = await db.trackingPixel.findFirst({ where: { id, shop: session.shop } });
    if (!pixel) return { ok: false, error: "No encontramos esa integración." };
    const code = String(form.get("testEventCode") ?? "").trim();
    try {
      await sendConversionTest(pixel, code);
      return { ok: true, message: "Evento Purchase de prueba enviado. Revísalo en Eventos de prueba de la plataforma." };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "No se pudo enviar la prueba." };
    }
  }

  const platform = String(form.get("platform") ?? "").toUpperCase();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const pixelId = String(form.get("pixelId") ?? "").trim();
  const tokenInput = String(form.get("apiToken") ?? "").trim();
  if (!PLATFORM_LABELS[platform] || !name || !validatePixelId(platform, pixelId)) {
    return { ok: false, error: "Revisa la plataforma, el nombre y el ID del píxel o conjunto de datos." };
  }
  if (tokenInput && tokenInput.length < 20) return { ok: false, error: "El token de acceso parece incompleto." };

  try {
    const existing = intent === "update" && id
      ? await db.trackingPixel.findFirst({ where: { id, shop: session.shop } })
      : null;
    if (intent === "update" && !existing) return { ok: false, error: "No encontramos esa integración." };
    if (!tokenInput && !existing?.apiToken) return { ok: false, error: "Pega el token de acceso de la Conversions API." };
    if (existing && existing.platform !== platform && !tokenInput) {
      return { ok: false, error: "Al cambiar de plataforma también debes pegar el token nuevo." };
    }

    const data = {
      platform,
      name,
      pixelId,
      apiToken: tokenInput ? encryptCredential(tokenInput) : existing?.apiToken,
      testEventCode: null,
      active: true,
      viewContent: false,
      addToCart: false,
      initiateCheckout: false,
      addPaymentInfo: false,
      purchase: isChecked(form, "purchase"),
      lastError: null,
    };
    if (existing) {
      await db.trackingPixel.update({ where: { id: existing.id }, data });
      return { ok: true, message: "Conversions API actualizada" };
    }
    await db.trackingPixel.create({ data: { ...data, shop: session.shop } });
    return { ok: true, message: "Conversions API conectada" };
  } catch {
    return { ok: false, error: "Ese ID ya está conectado para esta plataforma o no se pudo guardar." };
  }
};

function PixelForm({ pixel }: { pixel?: PixelView }) {
  return (
    <Form method="post" className="ga-pixel-form">
      <input type="hidden" name="intent" value={pixel ? "update" : "add"} />
      {pixel && <input type="hidden" name="id" value={pixel.id} />}
      <div className="ga-admin-grid">
        <label>Plataforma
          <select name="platform" defaultValue={pixel?.platform ?? "META"} required>
            <option value="META">Meta Conversions API (Facebook e Instagram)</option>
            <option value="TIKTOK">TikTok Events API</option>
          </select>
        </label>
        <label>Nombre interno
          <input name="name" defaultValue={pixel?.name ?? ""} placeholder="Ej. Global Aura Ecuador" maxLength={120} required />
        </label>
        <label>ID del píxel o conjunto de datos
          <input name="pixelId" defaultValue={pixel?.pixelId ?? ""} placeholder="Pega el ID, no el código completo" autoComplete="off" required />
        </label>
        <label>Token de acceso
          <input name="apiToken" type="password" placeholder={pixel?.tokenSaved ? "Token guardado; déjalo vacío para conservarlo" : "Pega el token de Conversions API"} autoComplete="new-password" />
        </label>
        <label>Código de evento de prueba <span className="ga-muted">(solo para probar)</span>
          <input name="testEventCode" defaultValue="" placeholder="Ej. TEST12345" autoComplete="off" />
        </label>
      </div>
      <div className="ga-event-grid">
        <label><input type="checkbox" name="purchase" defaultChecked={pixel?.purchase ?? true} /> Enviar Purchase</label>
      </div>
      <p className="ga-muted">Masad envía la compra desde su servidor únicamente después de que Shopify confirma el pedido. El correo y celular se convierten a SHA-256 antes de enviarse y el token queda cifrado; nunca se muestra en la tienda.</p>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <s-button type="submit" variant="primary">{pixel ? "Guardar conexión" : "Conectar API"}</s-button>
        {pixel?.tokenSaved && <button type="submit" name="testConnection" value="1" className="ga-test-event-button">Enviar evento de prueba</button>}
        {pixel && <s-button href="/app/pixels">Cancelar</s-button>}
      </div>
    </Form>
  );
}

function status(pixel: PixelView) {
  if (!pixel.active) return { label: "Inactiva", off: true };
  if (!pixel.tokenSaved) return { label: "Falta token", off: true };
  if (pixel.lastError) return { label: "Revisar conexión", off: true };
  return { label: pixel.lastSentAt ? "Enviando conversiones" : "Conectada", off: false };
}

export default function Pixels() {
  const { pixels } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const editingId = params.get("edit") ?? "";
  const editingPixel = pixels.find((pixel) => pixel.id === editingId);
  const showForm = params.get("new") === "1" || Boolean(editingPixel);

  return (
    <s-page heading="Conversions API">
      <s-section>
        <div className="ga-pixel-heading">
          <div><h2>Conversiones del servidor</h2><p>Conecta Meta o TikTok para medir pedidos confirmados sin depender del navegador.</p></div>
          <s-button href="/app/pixels?new=1" variant="primary">+ Conectar nueva API</s-button>
        </div>

        {showForm && <PixelForm pixel={editingPixel} />}
        {actionData && !actionData.ok && <p className="ga-form-error">{actionData.error}</p>}
        {actionData && actionData.ok && <p className="ga-muted">✓ {actionData.message}</p>}

        <div className="ga-pixel-list" aria-busy={navigation.state !== "idle"}>
          {pixels.map((pixel) => {
            const currentStatus = status(pixel);
            return (
              <div className="ga-pixel-row" key={pixel.id}>
                <div className="ga-pixel-platform"><span className={`ga-pixel-logo ${pixel.platform === "META" ? "meta" : "tiktok"}`}>{pixel.platform === "META" ? "f" : "♪"}</span>{PLATFORM_LABELS[pixel.platform] ?? pixel.platform}</div>
                <strong>{pixel.name}</strong>
                <div>
                  <div className="ga-pixel-id">ID: {pixel.pixelId}</div>
                  <span className={`ga-pixel-status ${currentStatus.off ? "off" : ""}`}>{currentStatus.label}</span>
                  {pixel.lastSentAt && <div className="ga-muted">Último envío: {new Date(pixel.lastSentAt).toLocaleString("es-EC")}</div>}
                  {pixel.lastError && <div className="ga-form-error" title={pixel.lastError}>{pixel.lastError}</div>}
                </div>
                <div className="ga-pixel-actions">
                  <s-button href={`/app/pixels?edit=${pixel.id}`} variant="tertiary">Editar</s-button>
                  <Form method="post"><input type="hidden" name="intent" value="toggle" /><input type="hidden" name="id" value={pixel.id} /><s-button type="submit" variant="tertiary">{pixel.active ? "Desactivar" : "Activar"}</s-button></Form>
                  <Form method="post" onSubmit={(event) => { if (!confirm("¿Eliminar esta conexión?")) event.preventDefault(); }}><input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={pixel.id} /><s-button type="submit" variant="tertiary">Eliminar</s-button></Form>
                </div>
              </div>
            );
          })}
          {!pixels.length && !showForm && <p className="ga-muted">Todavía no has conectado ninguna Conversions API.</p>}
        </div>

        <div className="ga-event-table">
          <h3>Evento enviado</h3>
          <div style={{ overflowX: "auto" }}><table className="ga-admin-table"><thead><tr><th>Plataforma</th><th>Evento</th><th>Momento exacto</th></tr></thead><tbody>
            <tr><td><strong>Meta</strong></td><td>Purchase</td><td>Después de que Shopify devuelve el pedido creado</td></tr>
            <tr><td><strong>TikTok</strong></td><td>Purchase</td><td>Después de que Shopify devuelve el pedido creado</td></tr>
          </tbody></table></div>
        </div>
      </s-section>
    </s-page>
  );
}
