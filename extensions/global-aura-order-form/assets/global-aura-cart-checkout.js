"use strict";

(() => {
  const root = document.querySelector("[data-ga-cart-checkout]");
  if (!root) return;

  const money = (value) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
  }).format(Number(value) || 0);
  const storeRoot = () => window.Shopify?.routes?.root || "/";
  const sessionKey = "global_aura_cart_session";
  const sessionId = () => {
    const existing = localStorage.getItem(sessionKey);
    if (existing) return existing;
    const next = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(sessionKey, next);
    return next;
  };
  const json = async (response, label) => {
    const text = await response.text();
    if (!text) throw new Error(`${label} (HTTP ${response.status})`);
    try { return JSON.parse(text); } catch { throw new Error(label); }
  };

  const setup = async () => {
    let settings = { config: {}, coverage: [] };
    let cart;
    try {
      const [settingsResponse, cartResponse] = await Promise.all([
        fetch(root.dataset.gaProxy, { headers: { accept: "application/json" } }),
        fetch(`${storeRoot()}cart.js`, { headers: { accept: "application/json" } }),
      ]);
      settings = await json(settingsResponse, "No se pudo cargar la configuración.");
      cart = await json(cartResponse, "No se pudo leer el carrito.");
      // La visibilidad del formulario de producto y el pago COD del carrito son
      // controles distintos. El bloque de carrito se habilita desde el editor
      // del tema, incluso si el formulario emergente de producto está apagado.
      if (!settingsResponse.ok || !cart?.items?.length) return;
    } catch { return; }

    const checkoutButtons = () => [...document.querySelectorAll("button, input[type='submit'], a")].filter((element) => {
      if (element.dataset.gaCartHandled) return false;
      const text = `${element.textContent || ""} ${element.value || ""}`.trim();
      return element.name === "checkout" || /finalizar pedido|ir a pagar|checkout/i.test(text) || element.matches("a[href$='/checkout'], a[href*='/checkout?'], [data-cart-checkout]");
    });
    // Algunos temas fuerzan `display` sobre el botón nativo y pueden ignorar
    // el atributo hidden. Marcamos y ocultamos el botón de forma explícita.
    const hideNativeCheckout = (button) => {
      button.dataset.gaCartHandled = "true";
      button.dataset.gaNativeCheckoutHidden = "true";
      button.hidden = true;
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
      button.style.setProperty("display", "none", "important");
    };
    const formStyle = settings.config?.formBuilder || {};
    const applyStoreStyle = (button) => {
      button.style.setProperty("--ga-cart-button-bg", formStyle.buttonBackground || "linear-gradient(135deg, #087ec4, #05a7ea)");
      button.style.setProperty("--ga-cart-button-text", formStyle.buttonTextColor || "#fff");
      button.style.setProperty("--ga-cart-button-border", formStyle.buttonBorderColor || formStyle.buttonBackground || "#087ec4");
      button.style.setProperty("--ga-cart-button-radius", `${formStyle.buttonRadius ?? 14}px`);
    };
    if (settings.fraud?.blocked) {
      checkoutButtons().forEach((original) => {
        const notice = document.createElement("button");
        notice.type = "button";
        notice.className = "ga-cart-cod-button ga-cart-fraud-blocked";
        notice.textContent = "PEDIDOS NO DISPONIBLES";
        notice.disabled = true;
        applyStoreStyle(notice);
        hideNativeCheckout(original);
        original.insertAdjacentElement("beforebegin", notice);
      });
      return;
    }

    const priorityFee = Number(settings.config?.priorityFee || root.dataset.gaPriorityFee || 2.5);
    const coverage = settings.coverage || [];
    const cartLines = () => cart.items.map((item) => ({
      variantId: item.variant_id,
      quantity: item.quantity,
      properties: Object.entries(item.properties || {})
        .filter(([, value]) => value != null && String(value).trim())
        .map(([name, value]) => ({ name, value: String(value) })),
    }));
    const subtotal = () => Number(cart.items_subtotal_price || 0) / 100;
    const modal = document.createElement("div");
    modal.className = "ga-order-modal ga-cart-checkout-modal";
    modal.style.setProperty("--ga-button-bg", formStyle.buttonBackground || "#087ec4");
    modal.style.setProperty("--ga-button-text", formStyle.buttonTextColor || "#fff");
    modal.style.setProperty("--ga-form-text", formStyle.formTextColor || "#0b2244");
    modal.hidden = true;
    modal.innerHTML = `
      <button class="ga-modal-backdrop" type="button" data-ga-cart-close aria-label="Cerrar formulario"></button>
      <section class="ga-order-form" role="dialog" aria-modal="true" aria-label="Completa tu pedido">
        <button class="ga-modal-close" type="button" data-ga-cart-close aria-label="Cerrar formulario">×</button>
        <div class="ga-form-heading"><span class="ga-form-kicker">PAGO CONTRA ENTREGA</span><h2>Completa tu pedido</h2><p>Confirma los datos para enviar los productos de tu carrito.</p></div>
        <form class="ga-form" novalidate>
          <div class="ga-cart-order-summary"><strong>Tu carrito</strong><div data-ga-cart-lines></div><div class="ga-cart-order-total"><span>Subtotal</span><b>${money(subtotal())}</b></div></div>
          <div class="ga-field"><label>Nombre completo <span>*</span><input name="fullName" autocomplete="name" placeholder="Ejem: Andrea España" required></label></div>
          <div class="ga-field"><label>Celular <span>*</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="Ejem: 0995393511" pattern="^(?:\\+?593|0)?9[0-9]{8}$" required></label></div>
          <div class="ga-two-columns"><div class="ga-field"><label>Provincia <span>*</span><select name="province" required><option value="">Provincia</option></select></label></div><div class="ga-field"><label>Ciudad <span>*</span><select name="city" required disabled><option value="">Ciudad</option></select></label></div></div>
          <div class="ga-field"><label>Dirección <span>*</span><input name="address" autocomplete="street-address" placeholder="Ejem: 6 de diciembre y Las Shyris" required></label></div>
          <div class="ga-field"><label>Referencia <span>*</span><input name="reference" placeholder="Ejem: Casa blanca junto al Tía" required></label></div>
          <div class="ga-field"><label>Correo electrónico <span>*</span><input name="email" type="email" autocomplete="email" placeholder="Ejem: usuario@gmail.com" required></label></div>
          <fieldset class="ga-options"><legend>Método de envío</legend><label><input type="radio" name="shippingMethod" value="FREE" checked><span><strong>Envío GRATIS</strong><small>Entrega normal</small></span><b>$0.00</b></label><label><input type="radio" name="shippingMethod" value="PRIORITY"><span><strong>Envío prioritario</strong><small>Preparación preferente</small></span><b>${money(priorityFee)}</b></label></fieldset>
          <label class="ga-consent"><input type="checkbox" name="consentWhatsapp" required><span>🔒 <strong>Importante:</strong> Confirmaré mi pedido y acepto recibir por WhatsApp información relacionada con esta compra.</span></label>
          <div class="ga-total"><span>Total estimado</span><strong data-ga-cart-total>${money(subtotal())}</strong></div>
          <button class="ga-submit" type="submit">PAGA AL RECIBIR</button><p class="ga-status" data-ga-cart-status aria-live="polite"></p>
        </form>
      </section>`;
    document.body.append(modal);

    const form = modal.querySelector("form");
    const province = form.elements.province;
    const city = form.elements.city;
    const status = modal.querySelector("[data-ga-cart-status]");
    const total = modal.querySelector("[data-ga-cart-total]");
    let completedOrder = false;
    const renderSummary = () => {
      modal.querySelector("[data-ga-cart-lines]").innerHTML = cart.items.map((item) =>
        `<div class="ga-cart-order-line"><span>${item.quantity} × ${item.product_title}${item.variant_title && item.variant_title !== "Default Title" ? ` · ${item.variant_title}` : ""}</span><b>${money(item.final_line_price / 100)}</b></div>`,
      ).join("");
    };
    const refreshTotal = () => {
      const shipping = form.elements.shippingMethod.value === "PRIORITY" ? priorityFee : 0;
      total.textContent = money(subtotal() + shipping);
    };
    renderSummary();
    [...new Set(coverage.map((entry) => entry.province))].sort((a, b) => a.localeCompare(b, "es")).forEach((name) => province.add(new Option(name, name)));
    province.addEventListener("change", () => {
      city.innerHTML = '<option value="">Ciudad</option>';
      coverage.filter((entry) => entry.province === province.value).forEach((entry) => city.add(new Option(entry.city, entry.city)));
      city.disabled = !province.value;
    });
    form.addEventListener("change", refreshTotal);
    const close = () => { modal.classList.remove("is-open"); document.documentElement.classList.remove("ga-modal-open"); setTimeout(() => { if (!modal.classList.contains("is-open")) modal.hidden = true; }, 180); };
    modal.querySelectorAll("[data-ga-cart-close]").forEach((button) => button.addEventListener("click", close));
    const open = () => { modal.hidden = false; requestAnimationFrame(() => modal.classList.add("is-open")); document.documentElement.classList.add("ga-modal-open"); setTimeout(() => form.elements.fullName.focus(), 160); };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (completedOrder) {
        window.location.href = storeRoot();
        return;
      }
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const submit = form.querySelector(".ga-submit");
      submit.disabled = true;
      status.textContent = "Estamos verificando tu pedido…";
      try {
        const upsells = await window.GAUpsells?.pre(root.dataset.gaProxy, { lines: cartLines() }) || [];
        const response = await fetch(root.dataset.gaProxy, {
          method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ intent: "place-cod", cart: {
            browserSessionId: sessionId(), fullName: form.elements.fullName.value, phone: form.elements.phone.value,
            email: form.elements.email.value, province: province.value, city: city.value, address: form.elements.address.value,
            reference: form.elements.reference.value, consentWhatsapp: form.elements.consentWhatsapp.checked,
            shippingMethod: form.elements.shippingMethod.value, paymentMethod: "COD", pageUrl: location.href, lines: cartLines(), upsells,
          } }),
        });
        const result = await json(response, "Respuesta inválida de la tienda.");
        if (!response.ok || result.error) throw new Error(result.error || "No se pudo procesar el pedido.");
        if (result.orderTotal != null) total.textContent = money(result.orderTotal);
        await fetch(`${storeRoot()}cart/clear.js`, { method: "POST", headers: { accept: "application/json" } }).catch(() => {});
        status.textContent = `✓ ${result.orderName} confirmado. Te contactaremos pronto.`;
        localStorage.removeItem(sessionKey);
        localStorage.removeItem("masad_marketing_attribution");
        form.querySelectorAll("input,select,button").forEach((element) => { element.disabled = true; });
        completedOrder = true;
        const updatedTotal = await window.GAUpsells?.post(root.dataset.gaProxy, result);
        if (updatedTotal != null) {
          total.textContent = money(updatedTotal);
          status.textContent = `✓ ${result.orderName} actualizado. Total a pagar al recibir: ${money(updatedTotal)}.`;
        }
        submit.disabled = false;
        submit.textContent = "HACER OTRO PEDIDO";
        await window.GAWhatsappConfirmation?.open(root.dataset.gaProxy, result, modal);
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "No se pudo procesar el pedido.";
        submit.disabled = false;
      }
    });

    const replaceCheckoutButtons = () => checkoutButtons().forEach((original) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ga-cart-cod-button";
      button.innerHTML = `&#128717; ${formStyle.buttonText || "PAGA AL RECIBIR"}`;
      applyStoreStyle(button);
      button.addEventListener("click", open);
      hideNativeCheckout(original);
      original.insertAdjacentElement("beforebegin", button);
    });
    replaceCheckoutButtons();
    new MutationObserver(replaceCheckoutButtons).observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
