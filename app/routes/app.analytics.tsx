import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureShopData } from "../services/bootstrap.server";

const DAY = 86_400_000;
const ECUADOR_OFFSET = 5 * 60 * 60 * 1000;
const localKey = (date: Date) => new Date(date.getTime() - ECUADOR_OFFSET).toISOString().slice(0, 10);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request); const config = await ensureShopData(session.shop);
  const todayLocal = new Date(Date.now() - ECUADOR_OFFSET); const startLocal = new Date(Date.UTC(todayLocal.getUTCFullYear(), todayLocal.getUTCMonth(), todayLocal.getUTCDate()) - 6 * DAY);
  const startUtc = new Date(startLocal.getTime() + ECUADOR_OFFSET);
  const rows = await db.cartSession.findMany({ where: { shop: session.shop, createdAt: { gte: startUtc } }, select: { createdAt: true, recoveredAt: true, orderId: true, orderTotal: true, subtotal: true, shippingMethod: true } });
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(startLocal.getTime() + index * DAY); return { key: date.toISOString().slice(0, 10), label: new Intl.DateTimeFormat("es-EC", { month: "short", day: "numeric", timeZone: "UTC" }).format(date), opens: 0, orders: 0, revenue: 0 }; });
  const byDay = new Map(days.map((day) => [day.key, day])); const seen = new Set<string>();
  for (const row of rows) {
    byDay.get(localKey(row.createdAt))!.opens += 1;
    if (!row.orderId || seen.has(row.orderId)) continue; seen.add(row.orderId);
    const orderDate = row.recoveredAt ?? row.createdAt; const bucket = byDay.get(localKey(orderDate)); if (!bucket) continue;
    bucket.orders += 1; bucket.revenue += row.orderTotal == null ? Number(row.subtotal) + (row.shippingMethod === "PRIORITY" ? Number(config.priorityFee) : 0) : Number(row.orderTotal);
  }
  return { days, totals: { opens: days.reduce((a, d) => a + d.opens, 0), orders: days.reduce((a, d) => a + d.orders, 0), revenue: days.reduce((a, d) => a + d.revenue, 0) } };
};

function Chart({ title, total, values, labels, money = false }: { title: string; total: number; values: number[]; labels: string[]; money?: boolean }) {
  const width = 620, height = 235, pad = 34, max = Math.max(...values, 1); const points = values.map((value, index) => `${pad + index * ((width - pad * 2) / 6)},${height - pad - (value / max) * (height - pad * 2)}`).join(" ");
  return <div style={{ border: "1px solid #dfe3e8", borderRadius: 14, padding: 18, background: "#fff" }}><h3 style={{ margin: 0 }}>{title} <strong style={{ marginLeft: 12 }}>{money ? `$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : total}</strong></h3><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${total}`} style={{ width: "100%", minHeight: 220, marginTop: 10 }}>
    {[0, .33, .66, 1].map((ratio) => <line key={ratio} x1={pad} x2={width - pad} y1={height - pad - ratio * (height - pad * 2)} y2={height - pad - ratio * (height - pad * 2)} stroke="#e6e8eb" />)}
    <polyline fill="none" stroke="#0797e3" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" points={points} />
    {values.map((value, index) => { const x = pad + index * ((width - pad * 2) / 6), y = height - pad - (value / max) * (height - pad * 2); return <g key={labels[index]}><circle cx={x} cy={y} r="5" fill="#fff" stroke="#0797e3" strokeWidth="3"><title>{labels[index]}: {money ? `$${value.toFixed(2)}` : value}</title></circle><text x={x} y={height - 8} textAnchor="middle" fontSize="11" fill="#6d7175">{labels[index]}</text></g>; })}
  </svg></div>;
}

export default function Analytics() { const data = useLoaderData<typeof loader>(); const labels = data.days.map((day) => day.label); return <s-page heading="Análisis"><s-section>
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}><p style={{ margin: 0, color: "#616a75" }}>Datos de los últimos 7 días en la zona horaria de Ecuador (America/Guayaquil).</p><span style={{ border: "1px solid #c9cccf", borderRadius: 9, padding: "8px 12px", background: "#fff" }}>📅 Últimos 7 días</span></div>
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}><Chart title="Inicios del formulario" total={data.totals.opens} values={data.days.map((d) => d.opens)} labels={labels} /><Chart title="Pedidos" total={data.totals.orders} values={data.days.map((d) => d.orders)} labels={labels} /></div>
  <div style={{ marginTop: 16 }}><Chart title="Recaudo" total={data.totals.revenue} values={data.days.map((d) => d.revenue)} labels={labels} money /></div>
  <p className="ga-muted">“Inicios del formulario” cuenta sesiones de carrito registradas; los pedidos se deduplican por ID de Shopify y el recaudo usa el total real confirmado.</p>
  </s-section></s-page>; }
