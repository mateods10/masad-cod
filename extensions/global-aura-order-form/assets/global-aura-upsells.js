"use strict";
(() => {
  if (window.GAUpsells) return;
  const money = n => new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(n);
  const request = async (proxy, body) => {
    const response = await fetch(proxy, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "No se pudo cargar la oferta.");
    return data;
  };
  const show = (offer, index, count, onAccept, post) => new Promise(resolve => {
    const previous = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "ga-upsell-dialog";
    dialog.setAttribute("aria-label", post ? "Oferta para tu pedido confirmado" : "Oferta adicional para tu pedido");
    const form = document.querySelector(".ga-order-modal,.ga-cart-order-modal");
    if (form) {
      const styles = getComputedStyle(form);
      ["--ga-button-bg", "--ga-button-text", "--ga-form-text"].forEach(key => { const value = styles.getPropertyValue(key); if (value) dialog.style.setProperty(key, value); });
    }
    const badge = document.createElement("small");
    badge.textContent = `${post ? "PEDIDO CONFIRMADO · " : ""}OFERTA ${index + 1} DE ${count}`;
    const heading = document.createElement("h2"); heading.textContent = offer.headline;
    dialog.append(badge, heading);
    if (offer.product.image) { const img = document.createElement("img"); img.src = offer.product.image; img.alt = offer.product.title; dialog.append(img); }
    const name = document.createElement("h3"); name.textContent = offer.product.title; dialog.append(name);
    if (offer.variantTitle !== "Default Title") { const variant = document.createElement("p"); variant.textContent = offer.variantTitle; dialog.append(variant); }
    const price = document.createElement("p"); price.className = "ga-upsell-price";
    if (offer.discountPercent) { const old = document.createElement("del"); old.textContent = money(offer.price); price.append(old, " "); }
    const actual = document.createElement("strong"); actual.textContent = money(offer.finalPrice); price.append(actual); dialog.append(price);
    const info = document.createElement("p"); info.textContent = "1 unidad adicional · Se suma al total a pagar al recibir."; dialog.append(info);
    const status = document.createElement("p"); status.setAttribute("role", "status");
    const accept = document.createElement("button"); accept.type = "button"; accept.className = "ga-upsell-accept"; accept.textContent = `Sí, agregar por ${money(offer.finalPrice)}`;
    const skip = document.createElement("button"); skip.type = "button"; skip.className = "ga-upsell-skip"; skip.textContent = "No, gracias. Continuar";
    const finish = value => { dialog.close(); dialog.remove(); previous?.focus?.(); resolve(value); };
    let busy = false;
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (!busy) finish(false); });
    skip.addEventListener("click", () => finish(false));
    accept.addEventListener("click", async () => {
      busy = true; accept.disabled = skip.disabled = true; status.textContent = "Agregando…";
      try { await onAccept(); finish(true); }
      catch (error) { status.textContent = error.message || "No se pudo agregar. Tu pedido original sigue confirmado."; skip.textContent = "Continuar con mi pedido"; skip.disabled = false; busy = false; }
    });
    dialog.append(accept, skip, status); document.body.append(dialog); dialog.showModal(); skip.focus();
  });
  window.GAUpsells = {
    async finish(proxy, result, modal) {
      const total = modal.querySelector("[data-ga-total]");
      if (total && result.orderTotal != null) total.textContent = money(result.orderTotal);
      const updated = await this.post(proxy, result);
      if (total && updated != null) total.textContent = money(updated);
      const status = modal.querySelector("[data-ga-status]");
      if (status && updated != null) { status.textContent = `✓ ${result.orderName} actualizado. Total a pagar al recibir: ${money(updated)}.`; status.dataset.state = "success"; }
      return await window.GAWhatsappConfirmation?.open(proxy, result, modal);
    },
    async pre(proxy, cart) {
      let offers;
      try { offers = (await request(proxy, { intent: "quote-upsells", cart: { lines: cart.lines } })).offers; } catch { return []; }
      const selected = [];
      for (const [index, offer] of (offers || []).entries()) {
        await show(offer, index, offers.length, async () => { selected.push({ campaignId: offer.campaignId, offerId: offer.id, expectedPrice: offer.finalPrice }); }, false);
      }
      return selected;
    },
    async post(proxy, result) {
      if (!result.postUpsellToken) return null;
      let offers;
      try { offers = (await request(proxy, { intent: "post-upsells", token: result.postUpsellToken })).offers; } catch { return null; }
      let total = null;
      for (const [index, offer] of (offers || []).entries()) {
        await show(offer, index, offers.length, async () => {
          const updated = await request(proxy, { intent: "accept-post-upsell", token: result.postUpsellToken, campaignId: offer.campaignId, offerId: offer.id, expectedPrice: offer.finalPrice });
          total = updated.total;
        }, true);
      }
      return total;
    },
  };
})();
