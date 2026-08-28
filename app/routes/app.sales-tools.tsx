import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureShopData } from "../services/bootstrap.server";
import { DEFAULT_SALES_TOOLS, parseSettings, safeText, type SalesToolsSettings } from "../services/app-settings.server";
import { publishAppSetting } from "../services/app-metafields.server";

const card = { border: "1px solid #dfe3e8", borderRadius: 14, padding: 18, background: "#fff" } as const;
const enabled = (form: FormData, name: string) => form.get(name) === "on";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await ensureShopData(session.shop);
  return { settings: parseSettings(config.salesToolsJson, DEFAULT_SALES_TOOLS), priorityFee: Number(config.priorityFee) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const price = Math.max(0, Math.min(100, Number(form.get("orderBumpPrice")) || 0));
  const settings: SalesToolsSettings = {
    quantityOffers: enabled(form, "quantityOffers"), packages: enabled(form, "packages"),
    orderBump: enabled(form, "orderBump"), orderBumpLabel: safeText(form.get("orderBumpLabel"), "Preparación prioritaria", 80), orderBumpPrice: price,
    prePurchaseUpsell: enabled(form, "prePurchaseUpsell"), downsell: enabled(form, "downsell"),
  };
  await db.appConfig.update({ where: { shop: session.shop }, data: { salesToolsJson: JSON.stringify(settings), priorityFee: price } });
  await publishAppSetting(admin, "sales_tools", settings);
  return { ok: true, message: "Herramientas de venta guardadas." };
};

function ToggleCard({ name, title, description, defaultChecked, badge }: { name: string; title: string; description: string; defaultChecked: boolean; badge?: string }) {
  return <label style={{ ...card, display: "grid", gridTemplateColumns: "auto 1fr", gap: 13, cursor: "pointer" }}><input type="checkbox" name={name} defaultChecked={defaultChecked} style={{ width: 20, height: 20 }} /><span><strong style={{ fontSize: 17 }}>{title}</strong>{badge && <em style={{ marginLeft: 8, padding: "3px 7px", borderRadius: 999, background: "#e5f3ff", color: "#075985", fontSize: 12 }}>{badge}</em>}<small style={{ display: "block", color: "#616a75", marginTop: 7, lineHeight: 1.45 }}>{description}</small></span></label>;
}

export default function SalesTools() {
  const data = useLoaderData<typeof loader>(); const actionData = useActionData<typeof action>(); const navigation = useNavigation();
  return <s-page heading="Ofertas, paquetes y upsells"><s-section>
    {actionData?.message && <p style={{ padding: 12, background: "#effaf3", color: "#176b35", borderRadius: 10 }}>✓ {actionData.message}</p>}
    <Form method="post"><div style={{ display: "grid", gap: 14 }}>
      <h2 style={{ marginBottom: 0 }}>Ofertas y paquetes por cantidad</h2>
      <ToggleCard name="quantityOffers" title="Ofertas por cantidad" description="Muestra cada variante de cantidad como una promoción y calcula automáticamente el ahorro desde el precio comparativo de Shopify." defaultChecked={data.settings.quantityOffers} />
      <ToggleCard name="packages" title="Paquetes con color y talla" badge="Activo en productos compatibles" description="Cuando el producto tiene Pack + Color/Talla, agrupa el pack y permite escoger las opciones de cada unidad sin duplicar el producto." defaultChecked={data.settings.packages} />
      <h2 style={{ marginBottom: 0 }}>Upsells y downsells</h2>
      <div style={card}><label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}><input type="checkbox" name="orderBump" defaultChecked={data.settings.orderBump} style={{ width: 20, height: 20 }} /> Incremento de pedido: envío prioritario</label><div className="ga-admin-grid" style={{ marginTop: 14 }}><label>Nombre de la opción<input name="orderBumpLabel" defaultValue={data.settings.orderBumpLabel} /></label><label>Precio (USD)<input name="orderBumpPrice" type="number" min="0" step="0.01" defaultValue={data.priorityFee || data.settings.orderBumpPrice} /></label></div><p className="ga-muted">Esta opción se publica dentro del formulario y se suma al total y al pedido real.</p></div>
      <ToggleCard name="prePurchaseUpsell" title="1-Click Upsell antes de comprar" description="Habilita el espacio para una oferta adicional antes de finalizar el pedido. La oferta se configura por producto desde sus variantes y metacampos." defaultChecked={data.settings.prePurchaseUpsell} />
      <ToggleCard name="downsell" title="Downsell al cerrar" description="Permite mostrar una oferta alternativa cuando el cliente intenta cerrar el formulario." defaultChecked={data.settings.downsell} />
      <div><s-button type="submit" variant="primary" {...(navigation.state === "submitting" ? { loading: true } : {})}>Guardar herramientas</s-button></div>
    </div></Form>
  </s-section></s-page>;
}
