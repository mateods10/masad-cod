"use strict";
(() => {
  const S = (o) =>
      new Intl.NumberFormat("es-EC", {
        style: "currency",
        currency: "USD",
      }).format(o),
    f = () => window.Shopify?.routes?.root || "/",
    T = () =>
      window.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  async function j(o, m) {
    const s = await o.text();
    if (!s) throw new Error(`${m} (HTTP ${o.status})`);
    try {
      return JSON.parse(s);
    } catch {
      throw new Error(m);
    }
  }
  document.querySelectorAll(".ga-order-modal[data-ga-proxy]").forEach(_);
  async function _(o) {
    const m = o.dataset.gaProxy;
    let s;
    try {
      const e = await fetch(m, { headers: { accept: "application/json" } });
      if (
        ((s = await j(e, "No se pudo cargar la configuraci\xF3n.")),
        e.ok && s.config?.formEnabled === !1)
      ) {
        o.remove();
        return;
      }
    } catch {
      s = { config: {}, coverage: [] };
    }
    if (!s.coverage?.length)
      try {
        await import(o.dataset.gaCoverage);
      } catch {}
    (document.documentElement.classList.add("ga-masad-enabled"),
      import(o.dataset.e));
    const n = o.querySelector("form");
    if (!n) return;
    const M = o.querySelector("[data-ga-status]"),
      D = o.querySelector("[data-ga-zone-alert]"),
      B = o.querySelector("[data-ga-agency-option]"),
      V = o.querySelector("[data-ga-sector-field]"),
      u = n.elements.province,
      g = n.elements.city,
      v = n.elements.quantity,
      P = [...n.querySelectorAll('input[name="variantId"]')],
      l = () => P.find((e) => e.checked),
      w = JSON.parse(
        o.querySelector("[data-ga-variant-map]")?.textContent || "[]",
      ),
      q = "global_aura_cart_session",
      A = localStorage.getItem(q) || T(),
      N = o.querySelector("[data-ga-variant-fieldset]"),
      d = document.querySelector(".ga-add-to-cart"),
      G = n.id || `ga-order-form-${T()}`;
    ((n.id = G),
      P.forEach((e) => e.setAttribute("form", G)),
      localStorage.setItem(q, A));
    let C = [],
      h = Number(o.dataset.gaPriorityFee || 2.5),
      $;
    const p = (e, t = "") => {
        ((M.textContent = e), (M.dataset.state = t));
      },
      W = () => {
        const e = document.querySelector(
          "#CartDrawer[open],dialog.cart-drawer[open]",
        );
        e &&
          (e.querySelector("[data-cart-drawer-close]")?.click(),
          e.hasAttribute("open") && typeof e.close == "function" && e.close());
      },
      F = () => {
        (W(),
          (o.hidden = !1),
          requestAnimationFrame(() => o.classList.add("is-open")),
          document.documentElement.classList.add("ga-modal-open"),
          setTimeout(() => n.elements.fullName?.focus(), 180));
      },
      H = () => {
        (o.classList.remove("is-open"),
          document.documentElement.classList.remove("ga-modal-open"),
          setTimeout(() => {
            o.classList.contains("is-open") || (o.hidden = !0);
          }, 180));
      };
    (document.addEventListener("keydown", (e) => {
      e.key === "Escape" && !o.hidden && H();
    }),
      document.addEventListener(
        "click",
        (e) => {
          if (
            o.contains(e.target) &&
            e.target.closest?.("[data-ga-modal-close]")
          ) {
            (e.preventDefault(), e.stopImmediatePropagation(), H());
            return;
          }
          e.target.closest?.(".ga-popup-trigger") &&
            (e.preventDefault(), e.stopImmediatePropagation(), F());
        },
        !0,
      ));
    const I = (e, t) => {
        const a = document.createElement("button");
        return (
          (a.type = "button"),
          (a.className = `ga-popup-trigger ga-popup-trigger--${e}`),
          (a.textContent = t),
          a.setAttribute("aria-haspopup", "dialog"),
          a.addEventListener("click", (r) => {
            (r.preventDefault(), r.stopImmediatePropagation(), F());
          }),
          a
        );
      },
      x = () => {
        const e = document.querySelector(".ga-add-to-cart,#es-popup-button");
        let t = document.querySelector(".ga-popup-trigger--main");
        if (
          (t || (t = I("main", "PAGA AL RECIBIR")),
          e &&
            t.nextElementSibling !== e &&
            e.insertAdjacentElement("beforebegin", t),
          !e)
        ) {
          const r = document.querySelector(".product-buybox");
          r && t.parentElement !== r && r.append(t);
        }
        const a = document.querySelector("#es-sticky");
        if (a && !a.dataset.gaMasadHandled) {
          let r = document.querySelector(".ga-popup-trigger--sticky");
          (r || (r = I("sticky", "PAGA AL RECIBIR")),
            a.insertAdjacentElement("beforebegin", r),
            (a.dataset.gaMasadHandled = "true"));
        }
        document.querySelectorAll(".es-popup-button-overwrite").forEach((r) => {
          r.dataset.gaMasadHandled ||
            (r.insertAdjacentElement(
              "beforebegin",
              I("drawer", "PAGA AL RECIBIR"),
            ),
            (r.dataset.gaMasadHandled = "true"));
        });
      };
    (x(), [600, 1600, 3200].forEach((e) => setTimeout(x, e)));
    const z = (e, t) =>
        w.find(
          (a) =>
            a.available &&
            a.option1 === e &&
            t.every((r, c) => a.options?.[c + 1] === r),
        ),
      X = (e, t) => {
        const a = [...e.querySelectorAll("[data-ga-unit-select]")],
          r = a.map((i) => i.value);
        let c = z(t, r);
        return (
          c ||
            ((c =
              w.find(
                (i) =>
                  i.available &&
                  i.option1 === t &&
                  (!r[0] || i.option2 === r[0]),
              ) || w.find((i) => i.available && i.option1 === t)),
            c &&
              a.forEach((i, te) => {
                i.value = c.options?.[te + 1] || i.value;
              })),
          c
        );
      },
      b = (e) => {
        if (!e) return null;
        const t = e.querySelector('input[name="variantId"]'),
          a = t?.dataset.pack;
        if (!t || !a) return null;
        const r = [...e.querySelectorAll("[data-ga-unit-row]")].map((i) =>
            X(i, a),
          ),
          c = r[0];
        if (c) {
          ((t.value = String(c.id)),
            (t.dataset.price = String(Number(c.price || 0) / 100)));
          const i = e.querySelector("[data-ga-pack-price]");
          i && (i.textContent = S(Number(c.price || 0) / 100));
        }
        return r.every(Boolean) ? c : null;
      },
      k = () => {
        const e = l()?.closest("[data-ga-pack-card]");
        return e
          ? [...e.querySelectorAll("[data-ga-unit-row]")]
              .map((t, a) => ({
                name: `Unidad ${a + 1}`,
                value: [...t.querySelectorAll("[data-ga-unit-select]")]
                  .map((r) => r.value)
                  .filter(Boolean)
                  .join(" / "),
              }))
              .filter((t) => t.value)
          : [];
      };
    N?.querySelectorAll("[data-ga-pack-card]").forEach(b);
    const Y = () =>
        l()
          ?.closest(".ga-variant-card")
          ?.querySelector(".ga-variant-info strong")
          ?.textContent?.trim() || "Opci\xF3n seleccionada",
      L = () => {
        d && l()?.value && (d.dataset.variantId = l().value);
      },
      K = async () => {
        const e = l();
        if (!d || !e || d.disabled) return;
        const t = e.closest("[data-ga-pack-card]");
        if (t && !b(t)) {
          p("Escoge color y talla.", "error");
          return;
        }
        L();
        const a = d.querySelector("[data-ga-add-text]"),
          r = Object.fromEntries(
            [{ name: "Opci\xF3n", value: Y() }, ...k()].map((c) => [
              c.name,
              c.value,
            ]),
          );
        ((d.disabled = !0), a && (a.textContent = "AGREGANDO..."));
        try {
          const c = await fetch(`${f()}cart/add.js`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "application/json",
                "x-requested-with": "XMLHttpRequest",
              },
              body: JSON.stringify({
                items: [{ id: Number(e.value), quantity: 1, properties: r }],
              }),
            }),
            i = await c.json();
          if (!c.ok || i.status)
            throw new Error(i.description || i.message || "No se agreg\xF3.");
          (window.GACartDrawer?.refresh
            ? await window.GACartDrawer.refresh({ open: !0 })
            : document.dispatchEvent(
                new CustomEvent("cart:updated", {
                  detail: { source: "masad-cod" },
                }),
              ),
            a && (a.textContent = "\u2713 AGREGADO AL CARRITO"),
            x(),
            setTimeout(() => {
              ((d.disabled = !1), a && (a.textContent = "AGREGAR AL CARRITO"));
            }, 700));
        } catch (c) {
          ((d.disabled = !1),
            a && (a.textContent = "INTENTAR NUEVAMENTE"),
            p(c.message || "No se pudo.", "error"));
        }
      };
    (L(),
      document.addEventListener(
        "click",
        (e) => {
          d &&
            e.target.closest?.(".ga-add-to-cart") === d &&
            (e.preventDefault(), e.stopImmediatePropagation(), K());
        },
        !0,
      ));
    const Q = () => Number(l()?.dataset.price || 0),
      y = () => {
        const e = n.elements.shippingMethod.value === "PRIORITY" ? h : 0;
        o.querySelector("[data-ga-total]").textContent = S(
          Q() * Number(v.value || 1) + e,
        );
      },
      Z = () => ({
        browserSessionId: A,
        fullName: n.elements.fullName.value,
        phone: n.elements.phone.value,
        email: n.elements.email.value,
        province: u.value,
        city: g.value,
        sector: n.elements.sector?.value || "",
        address: n.elements.address.value,
        reference: n.elements.reference.value,
        consentWhatsapp: n.elements.consentWhatsapp.checked,
        shippingMethod: n.elements.shippingMethod.value,
        paymentMethod: n.elements.paymentMethod.value,
        pageUrl: location.href,
        lines: [
          {
            variantId: l()?.value,
            quantity: Number(v.value || 1),
            properties: k(),
          },
        ],
      });
    async function O(e = "upsert", upsells = []) {
      const t = await fetch(m, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ intent: e, cart: { ...Z(), upsells } }),
        }),
        a = await j(t, "Respuesta inv\xE1lida de la tienda.");
      if (!t.ok || a.error) throw new Error(a.error || "No se pudo procesar.");
      return a;
    }
    function U(e) {
      (n
        .querySelectorAll('input[name="shippingMethod"]')
        .forEach((t) => (t.disabled = !1)),
        (B.hidden = !0),
        (D.hidden = !e.agencyRecommended),
        e.agencyRecommended &&
          (D.textContent =
            "Tu pedido continuar\xE1 normalmente. Un asesor revisar\xE1 la cobertura antes del despacho."),
        y());
    }
    async function ee() {
      if (!(n.elements.phone.value.replace(/\D/g, "").length < 9))
        try {
          U(await O());
        } catch {}
    }
    function E() {
      (clearTimeout($), ($ = setTimeout(ee, 900)));
    }
    ((C = s.coverage?.length
      ? s.coverage
      : Object.entries(window.GACoverage || {}).flatMap(([e, t]) =>
          t.map((a) => ({ province: e, city: a })),
        )),
      (h = Number(s.config?.priorityFee || h)),
      (o.querySelector("[data-ga-priority-label]").textContent = S(h)),
      (V.hidden = !s.config?.sectorFieldEnabled),
      (n.elements.sector.required = !!s.config?.sectorFieldEnabled),
      [...new Set(C.map((e) => e.province))]
        .sort((e, t) => e.localeCompare(t, "es"))
        .forEach((e) => u.add(new Option(e, e))),
      u.addEventListener("change", () => {
        ((g.innerHTML = '<option value="">Ciudad</option>'),
          C.filter((e) => e.province === u.value).forEach((e) =>
            g.add(new Option(e.city, e.city)),
          ),
          (g.disabled = !u.value),
          E());
      }));
    const R = (e) => {
        const t = e.target.closest?.("[data-ga-pack-card]");
        if (t) {
          if (e.target.matches("[data-ga-unit-select]")) {
            const a = t.querySelector('input[name="variantId"]');
            a && (a.checked = !0);
          }
          (b(t), y());
        }
        (e.target.name === "variantId" ||
          e.target.matches?.("[data-ga-unit-select]")) &&
          L();
      },
      J = (e) => {
        (R(e), y(), E());
      };
    (N?.addEventListener("input", J),
      N?.addEventListener("change", J),
      n.addEventListener("input", (e) => {
        (R(e),
          (e.target.name === "variantId" ||
            e.target === v ||
            e.target.name === "shippingMethod") &&
            y(),
          E());
      }),
      n.addEventListener("change", (e) => {
        (R(e), E());
      }),
      n.addEventListener("submit", async (e) => {
        e.preventDefault();
        const t = l()?.closest("[data-ga-pack-card]");
        if (t && !b(t)) {
          p("Escoge color y talla.", "error");
          return;
        }
        if (!n.checkValidity()) {
          n.reportValidity();
          return;
        }
        const a = n.querySelector(".ga-submit");
        ((a.disabled = !0), p("Estamos verificando tu pedido\u2026"));
        try {
          if (n.elements.paymentMethod.value === "COD") {
            const upsells = await window.GAUpsells?.pre(m, Z()) || [];
            const r = await O("place-cod", upsells);
            if (r.orderTotal != null) o.querySelector("[data-ga-total]").textContent = S(r.orderTotal);
            (p(
              `\u2705 ${r.orderName} confirmado. Te contactaremos pronto.`,
              "success",
            ),
              localStorage.removeItem(q));
            const updatedTotal = await window.GAUpsells?.post(m, r);
            if (updatedTotal != null) {
              o.querySelector("[data-ga-total]").textContent = S(updatedTotal);
              p(`✅ ${r.orderName} actualizado. Total a pagar al recibir: ${S(updatedTotal)}.`, "success");
            }
            setTimeout(() => location.reload(), 3500);
          } else {
            const r = await O();
            (U(r),
              await fetch(`${f()}cart/add.js`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  items: [
                    {
                      id: Number(l()?.value),
                      quantity: Number(v.value),
                      properties: Object.fromEntries(
                        k().map((c) => [c.name, c.value]),
                      ),
                    },
                  ],
                }),
              }),
              await fetch(`${f()}cart/update.js`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  attributes: {
                    global_aura_session_id: A,
                    "Nombre completo": n.elements.fullName.value,
                    Celular: n.elements.phone.value,
                    Provincia: u.value,
                    Ciudad: g.value,
                    Dirección: n.elements.address.value,
                    Referencia: n.elements.reference.value,
                  },
                }),
              }),
              (location.href = `${f()}checkout`));
          }
        } catch (r) {
          (p(r.message || "No se pudo procesar.", "error"), (a.disabled = !1));
        }
      }),
      y());
  }
})();
