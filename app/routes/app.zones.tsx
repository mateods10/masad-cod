import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import db from "../db.server";
import { normalizeText } from "../lib/domain";
import { authenticate } from "../shopify.server";
import { ensureShopData } from "../services/bootstrap.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await ensureShopData(session.shop);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const zones = await db.riskZone.findMany({
    where: q ? { shop: session.shop, OR: [{ province: { contains: q } }, { city: { contains: q } }, { sector: { contains: q } }] } : { shop: session.shop },
    orderBy: [{ active: "desc" }, { province: "asc" }, { city: "asc" }, { sector: "asc" }],
    take: 150,
  });
  return { q, zones };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (String(form.get("intent") ?? "") === "toggle") {
    const id = Number(form.get("id"));
    const zone = await db.riskZone.findFirst({ where: { id, shop: session.shop } });
    if (zone) await db.riskZone.update({ where: { id }, data: { active: !zone.active, source: "MANUAL" } });
    return { ok: true };
  }
  const province = String(form.get("province") ?? "").trim();
  const city = String(form.get("city") ?? "").trim();
  const sector = String(form.get("sector") ?? "").trim();
  if (!province || !city || !sector) return { ok: false, error: "Completa provincia, ciudad y sector" };
  await db.riskZone.upsert({
    where: { shop_normalizedProvince_normalizedCity_normalizedSector: { shop: session.shop, normalizedProvince: normalizeText(province), normalizedCity: normalizeText(city), normalizedSector: normalizeText(sector) } },
    update: { province, city, sector, active: true, source: "MANUAL" },
    create: { shop: session.shop, province, city, sector, normalizedProvince: normalizeText(province), normalizedCity: normalizeText(city), normalizedSector: normalizeText(sector), observation: "Retiro únicamente en agencia Servientrega.", source: "MANUAL" },
  });
  return { ok: true };
};

export default function Zones() {
  const { q, zones } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Zonas de alto riesgo">
      <s-section heading="Agregar o reactivar una zona">
        <Form method="post"><input type="hidden" name="intent" value="add" /><div className="ga-admin-grid"><label>Provincia<input name="province" required /></label><label>Ciudad<input name="city" required /></label><label>Sector o barrio<input name="sector" required /></label></div><div style={{ marginTop: 12 }}><s-button type="submit" variant="primary">Agregar zona</s-button></div></Form>
      </s-section>
      <s-section heading="Buscar">
        <Form method="get"><div style={{ display: "flex", gap: 8 }}><input name="q" defaultValue={q} placeholder="Provincia, ciudad o sector" style={{ flex: 1 }} /><s-button type="submit">Buscar</s-button></div></Form>
      </s-section>
      <s-section heading={`Listado (${zones.length})`}>
        <div style={{ overflowX: "auto" }}><table className="ga-admin-table"><thead><tr><th>Provincia</th><th>Ciudad</th><th>Sector</th><th>Origen</th><th>Estado</th><th></th></tr></thead><tbody>{zones.map((zone) => (
          <tr key={zone.id}><td>{zone.province}</td><td>{zone.city}</td><td>{zone.sector}</td><td>{zone.source}</td><td>{zone.active ? "Activa" : "Inactiva"}</td><td><Form method="post"><input type="hidden" name="intent" value="toggle" /><input type="hidden" name="id" value={zone.id} /><s-button type="submit" variant="tertiary">{zone.active ? "Desactivar" : "Activar"}</s-button></Form></td></tr>
        ))}</tbody></table></div>
      </s-section>
    </s-page>
  );
}
