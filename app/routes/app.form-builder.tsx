import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureShopData } from "../services/bootstrap.server";
import {
  DEFAULT_FORM_BUILDER,
  parseSettings,
  safeColor,
  safeText,
  type FormBuilderSettings,
} from "../services/app-settings.server";
import { publishAppSetting } from "../services/app-metafields.server";

const card = { border: "1px solid #dfe3e8", borderRadius: 14, padding: 18, background: "#fff" } as const;
const checked = (form: FormData, name: string) => form.get(name) === "on";
const number = (form: FormData, name: string, fallback: number, min: number, max: number) => {
  const value = Number(form.get(name));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await ensureShopData(session.shop);
  return { settings: parseSettings(config.formBuilderJson, DEFAULT_FORM_BUILDER) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const settings: FormBuilderSettings = {
    mode: form.get("mode") === "embedded" ? "embedded" : "popup",
    offerTemplate: form.get("offerTemplate") === "modern" ? "modern" : form.get("offerTemplate") === "vertical" ? "vertical" : "classic",
    offersInsideForm: checked(form, "offersInsideForm") || !checked(form, "offersAboveBuyButton"),
    offersAboveBuyButton: checked(form, "offersAboveBuyButton"),
    buttonText: safeText(form.get("buttonText"), DEFAULT_FORM_BUILDER.buttonText, 60),
    buttonSubtitle: String(form.get("buttonSubtitle") ?? "").trim().slice(0, 80),
    buttonBackground: safeColor(form.get("buttonBackground"), DEFAULT_FORM_BUILDER.buttonBackground),
    buttonTextColor: safeColor(form.get("buttonTextColor"), DEFAULT_FORM_BUILDER.buttonTextColor),
    buttonBorderColor: safeColor(form.get("buttonBorderColor"), DEFAULT_FORM_BUILDER.buttonBorderColor),
    buttonRadius: number(form, "buttonRadius", 14, 0, 40),
    formBackground: safeColor(form.get("formBackground"), DEFAULT_FORM_BUILDER.formBackground),
    formTextColor: safeColor(form.get("formTextColor"), DEFAULT_FORM_BUILDER.formTextColor),
    fieldBackground: safeColor(form.get("fieldBackground"), DEFAULT_FORM_BUILDER.fieldBackground),
    fieldBorderColor: safeColor(form.get("fieldBorderColor"), DEFAULT_FORM_BUILDER.fieldBorderColor),
    fieldRadius: number(form, "fieldRadius", 14, 0, 32),
    hideLabels: checked(form, "hideLabels"),
    disableAutocomplete: checked(form, "disableAutocomplete"),
    mobileFullscreen: checked(form, "mobileFullscreen"),
    hideClose: checked(form, "hideClose"),
    stickyButton: checked(form, "stickyButton"),
    stickyPosition: form.get("stickyPosition") === "top" ? "top" : "bottom",
    stickyDesktop: checked(form, "stickyDesktop"),
    showReference: checked(form, "showReference"),
    showEmail: checked(form, "showEmail"),
    requiredMessage: safeText(form.get("requiredMessage"), DEFAULT_FORM_BUILDER.requiredMessage, 120),
    invalidMessage: safeText(form.get("invalidMessage"), DEFAULT_FORM_BUILDER.invalidMessage, 120),
    soldOutLabel: safeText(form.get("soldOutLabel"), DEFAULT_FORM_BUILDER.soldOutLabel, 40),
  };
  await db.appConfig.update({ where: { shop: session.shop }, data: { formBuilderJson: JSON.stringify(settings) } });
  await publishAppSetting(admin, "form_builder", settings);
  return { ok: true, message: "El diseño del formulario quedó guardado y publicado." };
};

function ColorField({ label, name, value }: { label: string; name: string; value: string }) {
  return <label>{label}<div style={{ display: "flex", gap: 8 }}><input type="color" name={name} defaultValue={value} style={{ width: 48, padding: 3 }} /><input aria-label={`${label} hexadecimal`} defaultValue={value} readOnly /></div></label>;
}

function TemplateIcon({ type }: { type: FormBuilderSettings["offerTemplate"] }) {
  const row = <><span style={{ width: 42, borderRadius: 7, background: "#ddd" }} /><span style={{ flex: 1, display: "grid", gap: 7 }}><i style={{ height: 8, borderRadius: 5, background: "#ddd" }} /><i style={{ height: 8, width: "72%", borderRadius: 5, background: "#ddd" }} /></span></>;
  if (type === "modern") return <span style={{ display: "grid", gap: 7, width: "100%" }}>{[1, 2, 3].map((item) => <i key={item} style={{ height: 31, borderRadius: 6, background: "#ddd" }} />)}</span>;
  if (type === "vertical") return <span style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, width: "100%" }}>{[1, 2, 3].map((item) => <i key={item} style={{ height: 76, borderRadius: 9, background: "#ddd" }} />)}</span>;
  return <span style={{ display: "grid", gap: 8, width: "100%" }}>{[1, 2].map((item) => <i key={item} style={{ display: "flex", gap: 7, height: 42 }}>{row}</i>)}</span>;
}

function OfferPreview({ template }: { template: FormBuilderSettings["offerTemplate"] }) {
  const offers = ["1 unidad", "2 unidades", "3 unidades"];
  return <div style={{ display: "grid", gridTemplateColumns: template === "vertical" ? "repeat(3, 1fr)" : "1fr", gap: 7 }}>
    {offers.map((offer, index) => <div key={offer} style={{ display: "grid", gridTemplateColumns: template === "modern" ? "1fr auto" : template === "vertical" ? "1fr" : "42px 1fr auto", gap: 8, alignItems: "center", padding: template === "vertical" ? 9 : 8, textAlign: template === "vertical" ? "center" : "left", border: index === 1 ? "2px solid #0797e3" : "1px solid #d9e0eb", borderRadius: 10, background: index === 1 ? "#eef8ff" : "#fff" }}>
      {template !== "modern" && <span style={{ height: 38, borderRadius: 7, background: "#e4e7eb" }} />}
      <strong style={{ fontSize: 12 }}>{offer}</strong><b style={{ fontSize: 12 }}>${[19.99, 32.99, 44.99][index]}</b>
    </div>)}
  </div>;
}

function Preview({ settings }: { settings: FormBuilderSettings }) {
  const inputStyle = { padding: "12px 13px", border: `1px solid ${settings.fieldBorderColor}`, borderRadius: settings.fieldRadius, background: settings.fieldBackground };
  return <div style={{ background: "#606060", borderRadius: 16, padding: 12, maxHeight: 720, overflow: "auto" }}>
    <div style={{ background: settings.formBackground, color: settings.formTextColor, borderRadius: settings.mobileFullscreen ? 0 : 16, padding: 20, maxWidth: 430, margin: "0 auto" }}>
      {!settings.hideClose && <div style={{ float: "right", fontSize: 26 }}>×</div>}
      <h2 style={{ marginTop: 2 }}>Completa tu pedido</h2>
      <div style={{ display: "grid", gap: 9 }}>
        {settings.offersInsideForm && <OfferPreview template={settings.offerTemplate} />}
        <div style={{ padding: 12, border: "1px solid #d9e0eb", borderRadius: 10 }}><strong>Subtotal</strong><span style={{ float: "right" }}>$19.99</span></div>
        {["Nombre completo", "Celular", "Provincia", "Ciudad", "Dirección", ...(settings.showReference ? ["Referencia"] : []), ...(settings.showEmail ? ["Correo electrónico"] : [])].map((field) => <label key={field} style={{ display: "grid", gap: 5, fontWeight: 700 }}>{!settings.hideLabels && field}<div style={inputStyle}>{field}</div></label>)}
        <button type="button" style={{ border: `1px solid ${settings.buttonBorderColor}`, borderRadius: settings.buttonRadius, minHeight: 58, background: settings.buttonBackground, color: settings.buttonTextColor, fontWeight: 850, fontSize: 16 }}>
          {settings.buttonText}{settings.buttonSubtitle && <small style={{ display: "block", marginTop: 3 }}>{settings.buttonSubtitle}</small>}
        </button>
      </div>
    </div>
  </div>;
}

export default function FormBuilder() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [preview, setPreview] = useState(data.settings);
  const update = (name: keyof FormBuilderSettings, value: string | number | boolean) => setPreview((current) => ({ ...current, [name]: value }));

  return <s-page heading="Constructor de formularios">
    <s-section>
      {actionData?.message && <div style={{ padding: 12, borderRadius: 10, background: "#effaf3", color: "#176b35", marginBottom: 14 }}>✓ {actionData.message}</div>}
      <Form method="post" onChange={(event) => {
        const target = event.target as HTMLInputElement | HTMLSelectElement;
        if (!target.name || !(target.name in preview)) return;
        const value = target.type === "checkbox" ? (target as HTMLInputElement).checked : target.type === "range" || target.type === "number" ? Number(target.value) : target.value;
        update(target.name as keyof FormBuilderSettings, value);
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(330px, .8fr)", gap: 18, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 16 }}>
            <div style={card}>
              <h2 style={{ marginTop: 0 }}>Tipo de formulario</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ ...card, padding: 14, borderColor: preview.mode === "popup" ? "#087ec4" : "#dfe3e8", fontWeight: 800 }}><input type="radio" name="mode" value="popup" defaultChecked={data.settings.mode === "popup"} /> Formulario emergente</label>
                <label style={{ ...card, padding: 14, borderColor: preview.mode === "embedded" ? "#087ec4" : "#dfe3e8", fontWeight: 800 }}><input type="radio" name="mode" value="embedded" defaultChecked={data.settings.mode === "embedded"} /> Formulario incrustado</label>
              </div>
            </div>
            <div style={card}>
              <h2 style={{ marginTop: 0 }}>Diseño de las ofertas</h2>
              <h3 style={{ marginBottom: 10 }}>Plantilla</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                {([['classic', 'Clásico'], ['modern', 'Moderno'], ['vertical', 'Vertical']] as const).map(([value, label]) => <label key={value} style={{ display: "grid", gap: 8, minHeight: 138, padding: 11, border: `2px solid ${preview.offerTemplate === value ? "#087ec4" : "#dfe3e8"}`, borderRadius: 12, cursor: "pointer", textAlign: "center" }}><input type="radio" name="offerTemplate" value={value} defaultChecked={data.settings.offerTemplate === value} style={{ position: "absolute", opacity: 0 }} /><span>{label}</span><TemplateIcon type={value} /></label>)}
              </div>
              <h3 style={{ marginBottom: 10 }}>Mostrar ofertas en:</h3>
              <div className="ga-event-grid">
                <label><input type="checkbox" name="offersInsideForm" defaultChecked={data.settings.offersInsideForm} /> Dentro del formulario</label>
                <label><input type="checkbox" name="offersAboveBuyButton" defaultChecked={data.settings.offersAboveBuyButton} /> Encima del botón de compra</label>
              </div>
              {!preview.offersInsideForm && !preview.offersAboveBuyButton && <p className="ga-form-error">Selecciona por lo menos una ubicación para las ofertas.</p>}
            </div>
            <div style={card}>
              <h2 style={{ marginTop: 0 }}>Botón de compra</h2>
              <div className="ga-admin-grid">
                <label>Texto<input name="buttonText" defaultValue={data.settings.buttonText} /></label>
                <label>Subtítulo<input name="buttonSubtitle" defaultValue={data.settings.buttonSubtitle} placeholder="Opcional" /></label>
                <ColorField label="Color de fondo" name="buttonBackground" value={data.settings.buttonBackground} />
                <ColorField label="Color del texto" name="buttonTextColor" value={data.settings.buttonTextColor} />
                <ColorField label="Color del borde" name="buttonBorderColor" value={data.settings.buttonBorderColor} />
                <label>Esquinas redondeadas: {preview.buttonRadius}px<input type="range" name="buttonRadius" min="0" max="40" defaultValue={data.settings.buttonRadius} /></label>
              </div>
            </div>
            <div style={card}>
              <h2 style={{ marginTop: 0 }}>Formulario y campos</h2>
              <div className="ga-admin-grid">
                <ColorField label="Fondo del formulario" name="formBackground" value={data.settings.formBackground} />
                <ColorField label="Texto del formulario" name="formTextColor" value={data.settings.formTextColor} />
                <ColorField label="Fondo de campos" name="fieldBackground" value={data.settings.fieldBackground} />
                <ColorField label="Borde de campos" name="fieldBorderColor" value={data.settings.fieldBorderColor} />
                <label>Esquinas de campos: {preview.fieldRadius}px<input type="range" name="fieldRadius" min="0" max="32" defaultValue={data.settings.fieldRadius} /></label>
              </div>
              <h3>Campos visibles</h3>
              <div className="ga-event-grid"><label><input type="checkbox" checked readOnly /> Nombre</label><label><input type="checkbox" checked readOnly /> Teléfono</label><label><input type="checkbox" checked readOnly /> Provincia y ciudad</label><label><input type="checkbox" checked readOnly /> Dirección</label><label><input type="checkbox" name="showReference" defaultChecked={data.settings.showReference} /> Referencia</label><label><input type="checkbox" name="showEmail" defaultChecked={data.settings.showEmail} /> Correo</label></div>
            </div>
            <div style={card}>
              <h2 style={{ marginTop: 0 }}>Preferencias</h2>
              <div className="ga-event-grid">
                <label><input type="checkbox" name="hideLabels" defaultChecked={data.settings.hideLabels} /> Ocultar etiquetas</label>
                <label><input type="checkbox" name="disableAutocomplete" defaultChecked={data.settings.disableAutocomplete} /> Desactivar autocompletar</label>
                <label><input type="checkbox" name="mobileFullscreen" defaultChecked={data.settings.mobileFullscreen} /> Pantalla completa móvil</label>
                <label><input type="checkbox" name="hideClose" defaultChecked={data.settings.hideClose} /> Ocultar botón de cerrar</label>
                <label><input type="checkbox" name="stickyButton" defaultChecked={data.settings.stickyButton} /> Activar botón fijo</label>
                <label><input type="checkbox" name="stickyDesktop" defaultChecked={data.settings.stickyDesktop} /> Mostrar fijo en PC</label>
              </div>
              <label style={{ display: "block", marginTop: 12 }}>Posición del botón fijo <select name="stickyPosition" defaultValue={data.settings.stickyPosition}><option value="bottom">Inferior</option><option value="top">Superior</option></select></label>
              <h3>Mensajes de error</h3>
              <div className="ga-admin-grid"><label>Campo requerido<input name="requiredMessage" defaultValue={data.settings.requiredMessage} /></label><label>Campo inválido<input name="invalidMessage" defaultValue={data.settings.invalidMessage} /></label><label>Producto agotado<input name="soldOutLabel" defaultValue={data.settings.soldOutLabel} /></label></div>
            </div>
            <s-button type="submit" variant="primary" {...(navigation.state === "submitting" ? { loading: true } : {})}>Guardar y publicar</s-button>
          </div>
          <div style={{ position: "sticky", top: 16 }}><h3 style={{ textAlign: "center" }}>Vista previa en vivo</h3><Preview settings={preview} /></div>
        </div>
      </Form>
    </s-section>
  </s-page>;
}
