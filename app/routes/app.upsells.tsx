import { useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { randomUUID } from "node:crypto";
import { authenticate } from "../shopify.server";
import { ensureShopData } from "../services/bootstrap.server";
import db from "../db.server";
import { canonicalCampaign } from "../services/upsells.server";
import {
  offerPrice,
  readUpsells,
  validateUpsell,
  type UpsellCampaign,
  type UpsellOffer,
  type UpsellProduct,
} from "../lib/upsells";
import "../styles/upsells.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await ensureShopData(session.shop);
  return {
    campaigns: readUpsells(config.salesToolsJson),
    canPost: Boolean(session.scope?.split(",").includes("write_order_edits")),
  };
};
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  try {
    const config = await ensureShopData(session.shop);
    const campaigns = readUpsells(config.salesToolsJson);
    const id = String(form.get("id") || "");
    const existing = campaigns.find((c) => c.id === id);
    const intent = form.get("intent");
    let next: UpsellCampaign[];
    let savedId = id;
    if (intent === "toggle" || intent === "delete") {
      if (!existing)
        throw new Error("La oferta ya no existe. Actualiza la página.");
      if (intent === "toggle" && !existing.active && existing.mode === "POST" && !session.scope?.split(",").includes("write_order_edits")) throw new Error("Edita esta oferta y autoriza la edición de pedidos antes de activarla.");
      next =
        intent === "delete"
          ? campaigns.filter((c) => c.id !== id)
          : campaigns.map((c) =>
              c.id === id ? { ...c, active: !c.active } : c,
            );
    } else if (intent === "save") {
      const raw = String(form.get("campaign") || "");
      if (raw.length > 100000)
        throw new Error("La configuración es demasiado grande.");
      if (id && !existing)
        throw new Error("La oferta ya no existe. Actualiza la página.");
      if (!existing && campaigns.length >= 30)
        throw new Error("Puedes crear hasta 30 grupos de upsells.");
      const c = await canonicalCampaign(admin, validateUpsell(JSON.parse(raw)));
      if (
        c.active &&
        c.mode === "POST" &&
        !session.scope?.split(",").includes("write_order_edits")
      )
        throw new Error(
          "Autoriza el permiso de edición de pedidos antes de activar ofertas post-compra.",
        );
      savedId = existing?.id || randomUUID();
      c.id = savedId;
      // Resolve trigger names in this store; never trust another store's IDs.
      const response = await admin.graphql(
        `#graphql
        query MasadUpsellTriggers($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title featuredImage { url } } } }
      `,
        { variables: { ids: c.triggers.map((p) => p.id) } },
      );
      const body = (await response.json()) as {
        data?: {
          nodes: Array<{
            id: string;
            title: string;
            featuredImage: { url: string } | null;
          } | null>;
        };
      };
      if (!body.data || body.data.nodes.some((p) => !p?.id))
        throw new Error(
          "Un producto seleccionado ya no existe en esta tienda.",
        );
      c.triggers = body.data.nodes.map((p) => ({
        id: p!.id,
        title: p!.title,
        image: p!.featuredImage?.url || "",
      }));
      next = existing
        ? campaigns.map((old) => (old.id === id ? c : old))
        : [...campaigns, c];
    } else throw new Error("Acción inválida.");
    // Compare-and-swap protects other settings and concurrent edits.
    const updated = await db.appConfig.updateMany({
      where: { shop: session.shop, salesToolsJson: config.salesToolsJson },
      data: {
        salesToolsJson: JSON.stringify({
          ...JSON.parse(config.salesToolsJson),
          upsells: next,
        }),
      },
    });
    if (!updated.count)
      throw new Error(
        "Otra configuración cambió mientras editabas. Actualiza la página e inténtalo de nuevo.",
      );
    return {
      ok: true,
      message: intent === "delete" ? "Upsell eliminado." : "Upsell guardado.",
      savedId,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo guardar el upsell.",
      savedId: "",
    };
  }
};
const money = (n: number) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(
    n,
  );
const emptyOffer = (): UpsellOffer => ({
  id: crypto.randomUUID(),
  product: { id: "", title: "", image: "" },
  variantId: "",
  variantTitle: "",
  price: 0,
  discountPercent: 10,
  headline: "¡Completa tu pedido con esta oferta!",
});

export default function Upsells() {
  const { campaigns, canPost } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const result = useActionData<typeof action>();
  const edit = params.get("edit");
  const selected = campaigns.find((c) => c.id === edit);
  return (
    <s-page heading="1-Click Upsells">
      <div className="mu-shell">
        <Link to="/app/sales-tools">← Ofertas y upsells</Link>
        {result && (
          <div
            role="status"
            className={`mu-notice ${result.ok ? "mu-success" : "mu-error"}`}
          >
            {result.message}
          </div>
        )}
        {edit ? (
          <UpsellEditor
            key={edit}
            initial={selected}
            canPost={canPost}
            savedId={result?.ok && edit === "new" ? result.savedId : undefined}
          />
        ) : (
          <>
            <div className="mu-toolbar">
              <p>
                Ofrece productos adicionales elegidos por ti antes o después de confirmar el pedido.
              </p>
              <Link className="mu-primary" to="?edit=new">
                ＋ Crear 1-Click Upsell
              </Link>
            </div>
            {!campaigns.length ? (
              <section className="mu-card mu-empty">
                <div className="mu-illustration" aria-hidden="true">
                  ▢ ＋ ▢
                </div>
                <h2>Crea tu primera venta adicional</h2>
                <p>
                  Elige los productos que activan la oferta y qué producto
                  quieres recomendar.
                  <br />
                  Puedes mostrar hasta 5 ofertas seguidas.
                </p>
                <Link className="mu-primary" to="?edit=new">
                  Crear 1-Click Upsell
                </Link>
              </section>
            ) : (
              <div className="mu-list">
                {campaigns.map((c) => (
                  <section className="mu-card mu-toolbar" key={c.id}>
                    <div>
                      <Link to={`?edit=${c.id}`}>
                        <strong>{c.name}</strong>
                      </Link>
                      <p>
                        {c.triggers.length} productos · {c.offers.length}{" "}
                        ofertas · {c.mode === "POST" ? "Post-compra" : "Pre-compra"}
                      </p>
                      <span
                        className={`mu-badge ${c.active ? "mu-active" : ""}`}
                      >
                        {c.active ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                    <div className="mu-actions">
                      <Link className="mu-secondary" to={`?edit=${c.id}`}>
                        Editar
                      </Link>
                      <Form method="post">
                        <input type="hidden" name="id" value={c.id} />
                        <button
                          name="intent"
                          value="toggle"
                          className="mu-secondary"
                        >
                          {c.active ? "Desactivar" : "Activar"}
                        </button>
                      </Form>
                      <Form
                        method="post"
                        onSubmit={(e) => {
                          if (!window.confirm(`¿Eliminar «${c.name}»?`))
                            e.preventDefault();
                        }}
                      >
                        <input type="hidden" name="id" value={c.id} />
                        <button
                          name="intent"
                          value="delete"
                          className="mu-danger"
                        >
                          Eliminar
                        </button>
                      </Form>
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </s-page>
  );
}
function UpsellEditor({
  initial,
  savedId,
  canPost,
}: {
  initial?: UpsellCampaign;
  savedId?: string;
  canPost: boolean;
}) {
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const [campaign, setCampaign] = useState<UpsellCampaign>(
    () =>
      initial || {
        id: "",
        name: "Nueva venta adicional",
        active: false,
        mode: "PRE",
        triggers: [],
        offers: [emptyOffer()],
      },
  );
  const [preview, setPreview] = useState(0);
  const [pickerError, setPickerError] = useState("");
  const [picking, setPicking] = useState(false);
  const patch = (value: Partial<UpsellCampaign>) =>
    setCampaign((c) => ({ ...c, ...value }));
  const updateOffer = (index: number, value: Partial<UpsellOffer>) =>
    setCampaign((c) => ({
      ...c,
      offers: c.offers.map((o, i) => (i === index ? { ...o, ...value } : o)),
    }));
  const choose = async (index?: number) => {
    setPickerError("");
    setPicking(true);
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: index === undefined ? 100 : false,
        filter: {
          variants: index !== undefined,
          draft: false,
          archived: false,
        },
        selectionIds:
          index === undefined
            ? campaign.triggers.map((p) => ({ id: p.id }))
            : campaign.offers[index].product.id
              ? [
                  {
                    id: campaign.offers[index].product.id,
                    variants: [{ id: campaign.offers[index].variantId }],
                  },
                ]
              : [],
      });
      if (!selected) return;
      const products = selected as unknown as Array<{
        id: string;
        title: string;
        images?: { originalSrc?: string }[];
        variants: { id: string; title: string; price: string }[];
      }>;
      const product = (p: (typeof products)[number]): UpsellProduct => ({
        id: p.id,
        title: p.title,
        image: p.images?.[0]?.originalSrc || "",
      });
      if (index === undefined) patch({ triggers: products.map(product) });
      else if (products[0]?.variants?.[0]) {
        const p = products[0];
        const v = p.variants[0];
        updateOffer(index, {
          product: product(p),
          variantId: v.id,
          variantTitle: v.title,
          price: Number(v.price),
        });
        setPreview(index);
      }
    } catch {
      setPickerError(
        "No se pudo abrir el selector. Abre Masad COD desde el administrador de Shopify y vuelve a intentarlo.",
      );
    } finally {
      setPicking(false);
    }
  };
  const offer = campaign.offers[preview] || campaign.offers[0];
  return (
    <Form method="post" className="mu-editor">
      <input type="hidden" name="intent" value="save" />
      <input type="hidden" name="id" value={campaign.id || savedId || ""} />
      <input type="hidden" name="campaign" value={JSON.stringify(campaign)} />
      <div className="mu-toolbar mu-editor-header">
        <Link to="/app/upsells">← Todos los upsells</Link>
        <label className="mu-switch">
          <input
            type="checkbox"
            checked={campaign.active}
            onChange={(e) => patch({ active: e.target.checked })}
          />{" "}
          {campaign.active ? "Activo" : "Inactivo"}
        </label>
      </div>
      {pickerError && (
        <p role="alert" className="mu-error mu-notice">
          {pickerError}
        </p>
      )}
      <div className="mu-columns">
        <div className="mu-fields">
          <section className="mu-card">
            <label>
              Nombre interno
              <input
                required
                maxLength={100}
                value={campaign.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
          </section>
          <section className="mu-card">
            <h2>Modo de venta adicional</h2>
            <div className="mu-actions">
              <button
                type="button"
                className={
                  campaign.mode === "PRE" ? "mu-primary" : "mu-secondary"
                }
                onClick={() => patch({ mode: "PRE" })}
              >
                Pre-compra
              </button>
              <button
                type="button"
                className={
                  campaign.mode === "POST" ? "mu-primary" : "mu-secondary"
                }
                onClick={() => patch({ mode: "POST" })}
              >
                Post-compra
              </button>
            </div>
            <p>
              {campaign.mode === "PRE"
                ? "La oferta aparece antes de confirmar el pedido y se incluye en el mismo pedido contra entrega."
                : "La oferta aparece después de confirmar el pedido. Al aceptarla, se agrega al mismo pedido y se actualiza el total a pagar al recibir."}
            </p>
            {campaign.mode === "POST" && !canPost && (
              <div className="mu-notice">
                Shopify requiere permiso para editar pedidos. Puedes guardar el
                borrador; autoriza el permiso para activarlo.
                <button
                  type="button"
                  className="mu-secondary"
                  onClick={async () => {
                    try {
                      await shopify.scopes.request(["write_order_edits"]);
                      window.location.reload();
                    } catch {
                      setPickerError(
                        "No se pudo autorizar el permiso. Vuelve a abrir la app desde Shopify.",
                      );
                    }
                  }}
                >
                  Autorizar edición de pedidos
                </button>
              </div>
            )}
          </section>
          <section className="mu-card">
            <h2>1. Si el cliente compra uno de estos productos</h2>
            <button
              type="button"
              className="mu-secondary"
              disabled={picking}
              onClick={() => choose()}
            >
              Seleccionar productos ({campaign.triggers.length})
            </button>
            <div className="mu-products">
              {campaign.triggers.map((p) => (
                <div className="mu-product" key={p.id}>
                  {p.image && <img src={p.image} alt="" />}
                  <span>{p.title}</span>
                  <button
                    type="button"
                    className="mu-remove"
                    aria-label={`Quitar ${p.title}`}
                    onClick={() =>
                      patch({
                        triggers: campaign.triggers.filter(
                          (x) => x.id !== p.id,
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className="mu-muted">
              La oferta se activa si el pedido contiene cualquiera de los
              productos seleccionados.
            </p>
          </section>
          <div className="mu-toolbar">
            <h2>2. Productos que quieres ofrecer</h2>
            <button
              type="button"
              className="mu-secondary"
              disabled={campaign.offers.length >= 5}
              onClick={() => {
                patch({ offers: [...campaign.offers, emptyOffer()] });
                setPreview(campaign.offers.length);
              }}
            >
              ＋ Agregar oferta
            </button>
          </div>
          {campaign.offers.map((o, i) => (
            <section
              className={`mu-card mu-offer ${preview === i ? "mu-selected" : ""}`}
              key={o.id}
            >
              <div className="mu-toolbar">
                <button
                  type="button"
                  className="mu-plain"
                  onClick={() => setPreview(i)}
                >
                  <strong>Oferta #{i + 1}</strong> · {o.discountPercent}% de
                  descuento
                </button>
                <div className="mu-actions">
                  <button
                    type="button"
                    className="mu-remove"
                    aria-label="Subir oferta"
                    disabled={i === 0}
                    onClick={() => {
                      const offers = [...campaign.offers];
                      [offers[i - 1], offers[i]] = [offers[i], offers[i - 1]];
                      patch({ offers });
                      setPreview(i - 1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="mu-remove"
                    aria-label="Eliminar oferta"
                    disabled={campaign.offers.length === 1}
                    onClick={() => {
                      patch({
                        offers: campaign.offers.filter((_, j) => j !== i),
                      });
                      setPreview(0);
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
              {o.product.id && (
                <div className="mu-product">
                  {o.product.image && <img src={o.product.image} alt="" />}
                  <span>
                    <strong>{o.product.title}</strong>
                    <small>
                      {o.variantTitle !== "Default Title" ? o.variantTitle : ""}
                    </small>
                  </span>
                </div>
              )}
              <button
                type="button"
                className="mu-secondary"
                disabled={picking}
                onClick={() => choose(i)}
              >
                {o.product.id
                  ? "Cambiar producto o variante"
                  : "Seleccionar producto"}
              </button>
              <div className="mu-offer-fields">
                <label>
                  Título de la oferta
                  <input
                    maxLength={100}
                    value={o.headline}
                    onChange={(e) =>
                      updateOffer(i, { headline: e.target.value })
                    }
                  />
                </label>
                <label>
                  Descuento (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    required
                    value={o.discountPercent}
                    onChange={(e) => {
                      updateOffer(i, {
                        discountPercent: Number(e.target.value),
                      });
                      setPreview(i);
                    }}
                  />
                </label>
              </div>
              {o.product.id && (
                <p className="mu-price">
                  <del>{money(o.price)}</del>{" "}
                  <strong>
                    {money(offerPrice(o.price, o.discountPercent))}
                  </strong>
                  <small>Una unidad · precio actualizado al comprar</small>
                </p>
              )}
            </section>
          ))}
          <div className="mu-notice">
            Hasta 5 ofertas. Al aceptar o rechazar una, se mostrará la
            siguiente. El cliente siempre puede continuar sin agregarlas.
          </div>
        </div>
        <aside className="mu-preview">
          <h2>Vista previa · Oferta #{preview + 1}</h2>
          <div className="mu-card">
            {offer.product.id ? (
              <>
                <span className="mu-badge">OFERTA ESPECIAL</span>
                <h2>{offer.headline}</h2>
                {offer.product.image && (
                  <img
                    className="mu-preview-image"
                    src={offer.product.image}
                    alt={offer.product.title}
                  />
                )}
                <h3>{offer.product.title}</h3>
                <p>
                  {offer.variantTitle !== "Default Title"
                    ? offer.variantTitle
                    : ""}
                </p>
                <p className="mu-price">
                  <del>{money(offer.price)}</del>{" "}
                  <strong>
                    {money(offerPrice(offer.price, offer.discountPercent))}
                  </strong>
                </p>
                <span className="mu-primary mu-preview-cta">
                  Sí, agregar a mi pedido
                </span>
                <p>No, gracias. Continuar</p>
              </>
            ) : (
              <div className="mu-empty">
                <div className="mu-illustration" aria-hidden="true">
                  ＋
                </div>
                <p>Selecciona un producto para previsualizar tu oferta.</p>
              </div>
            )}
          </div>
          <p className="mu-muted">
            La oferta real toma los colores del formulario de tu tienda.
          </p>
        </aside>
      </div>
      <div className="mu-save">
        <Link className="mu-secondary" to="/app/upsells">
          Volver al listado
        </Link>
        <button
          className="mu-primary"
          disabled={navigation.state !== "idle" || picking}
          type="submit"
        >
          {navigation.state !== "idle" ? "Guardando…" : "Guardar upsell"}
        </button>
      </div>
    </Form>
  );
}
