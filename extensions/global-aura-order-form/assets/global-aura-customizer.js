const initMasadCustomizer = async () => {
  const modals = document.querySelectorAll(".ga-order-modal[data-ga-proxy]");
  for (const modal of modals) {
    let data = { config: {} };
    try { data.config.formBuilder = JSON.parse(modal.dataset.gaFormSettings || "{}"); } catch {}
    try { data.config.salesTools = JSON.parse(modal.dataset.gaSalesSettings || "{}"); } catch {}
    // Estas preferencias ya llegan publicadas como metafields en el HTML de
    // Shopify. Volver a pedirlas al proxy retrasaba ofertas y botón sin aportar
    // información nueva.
    const formSettings = data.config?.formBuilder || {};
    const sales = data.config?.salesTools || {};
    modal.classList.add("ga-customized", `ga-mode-${formSettings.mode || "popup"}`);
    modal.classList.add(`ga-offers-template-${formSettings.offerTemplate || "classic"}`);
    if (formSettings.hideLabels) modal.classList.add("ga-hide-labels");
    if (formSettings.mobileFullscreen) modal.classList.add("ga-mobile-fullscreen");
    const style = modal.style;
    style.setProperty("--ga-form-bg", formSettings.formBackground || "#fff");
    style.setProperty("--ga-form-text", formSettings.formTextColor || "#0b2244");
    style.setProperty("--ga-field-bg", formSettings.fieldBackground || "#f5f7fb");
    style.setProperty("--ga-field-border", formSettings.fieldBorderColor || "#d9e0eb");
    style.setProperty("--ga-field-radius", `${formSettings.fieldRadius ?? 14}px`);
    style.setProperty("--ga-button-bg", formSettings.buttonBackground || "#0797e3");
    style.setProperty("--ga-button-text", formSettings.buttonTextColor || "#fff");
    style.setProperty("--ga-button-border", formSettings.buttonBorderColor || "#0797e3");
    style.setProperty("--ga-button-radius", `${formSettings.buttonRadius ?? 14}px`);
    if (formSettings.mode === "embedded") { modal.hidden = false; modal.classList.add("is-open"); }
    if (formSettings.hideClose) modal.querySelectorAll("[data-ga-modal-close]").forEach((element) => { element.style.display = "none"; });
    const form = modal.querySelector("form");
    if (!form) continue;
    [["reference", formSettings.showReference], ["email", formSettings.showEmail]].forEach(([name, show]) => {
      if (show === false) {
        const input = form.elements[name];
        if (input) { input.required = false; input.closest(".ga-field").hidden = true; }
      }
    });
    if (formSettings.disableAutocomplete) form.querySelectorAll("input").forEach((input) => { input.autocomplete = "off"; });
    form.querySelectorAll("input,select").forEach((field) => field.addEventListener("invalid", () => {
      field.setCustomValidity(field.validity.valueMissing ? formSettings.requiredMessage || "Este campo es obligatorio." : formSettings.invalidMessage || "Este campo no es válido.");
    }));
    form.addEventListener("input", (event) => event.target?.setCustomValidity?.(""));
    if (sales.quantityOffers === false) modal.querySelectorAll(".ga-variant-info em,.ga-variant-prices del").forEach((element) => { element.hidden = true; });
    const priority = form.querySelector('input[name="shippingMethod"][value="PRIORITY"]')?.closest("label");
    if (priority) {
      priority.hidden = sales.orderBump === false;
      const title = priority.querySelector("strong");
      if (title && sales.orderBumpLabel) title.textContent = sales.orderBumpLabel;
    }
    const decorate = () => document.querySelectorAll(".ga-popup-trigger").forEach((button) => {
      button.classList.add("ga-customized-trigger");
      button.style.setProperty("--ga-button-bg", formSettings.buttonBackground || "#0797e3");
      button.style.setProperty("--ga-button-text", formSettings.buttonTextColor || "#fff");
      button.style.setProperty("--ga-button-border", formSettings.buttonBorderColor || "#0797e3");
      button.style.setProperty("--ga-button-radius", `${formSettings.buttonRadius ?? 14}px`);
      button.textContent = formSettings.buttonText || "PAGA AL RECIBIR";
      if (formSettings.buttonSubtitle) {
        const small = document.createElement("small"); small.textContent = formSettings.buttonSubtitle; small.style.display = "block"; button.append(small);
      }
    });
    decorate();
    [500, 1600].forEach((delay) => setTimeout(decorate, delay));
    const placeOffers = () => {
      const offers = modal.querySelector("[data-ga-variant-fieldset]");
      const anchor = modal.querySelector("[data-ga-offers-anchor]");
      const trigger = document.querySelector(".ga-popup-trigger--main");
      if (!offers || !anchor) return;
      const inside = formSettings.offersInsideForm !== false;
      const above = formSettings.offersAboveBuyButton === true;
      offers.hidden = !inside;
      document.querySelectorAll(".ga-offers-external").forEach((element) => element.remove());
      if (inside) anchor.insertAdjacentElement("afterend", offers);
      if (above && trigger) {
        // Mantener siempre el selector original dentro del formulario permite
        // que la lógica principal se inicialice aunque el proxy todavía esté
        // respondiendo. La vista externa es una copia sincronizada.
        const clone = offers.cloneNode(true);
        clone.hidden = false;
        clone.classList.add("ga-variants--inline", "ga-offers-external");
        clone.removeAttribute("data-ga-variant-fieldset");
        clone.querySelectorAll('input[name="variantId"]').forEach((input) => {
          input.name = "externalVariantId";
          input.removeAttribute("form");
        });
        clone.addEventListener("change", (event) => {
          const target = event.target;
          if (target.matches('input[name="externalVariantId"]')) {
            const original = offers.querySelector(`input[name="variantId"][value="${target.value}"]`);
            if (original) { original.checked = true; original.dispatchEvent(new Event("change", { bubbles: true })); }
          } else if (target.matches("[data-ga-unit-select]")) {
            const selects = [...clone.querySelectorAll("[data-ga-unit-select]")];
            const original = offers.querySelectorAll("[data-ga-unit-select]")[selects.indexOf(target)];
            if (original) { original.value = target.value; original.dispatchEvent(new Event("change", { bubbles: true })); }
          }
        });
        trigger.insertAdjacentElement("beforebegin", clone);
      }
    };
    placeOffers();
    [550, 1700].forEach((delay) => setTimeout(placeOffers, delay));

    // The offer cards act as the product's variant picker. Keep the visible
    // price in the product buy box in sync, even when the cards are rendered
    // above the purchase button as a cloned external picker.
    const money = (amount) => new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", minimumFractionDigits: 2,
    }).format(amount);
    const syncProductPrice = () => {
      const selected = form.querySelector('input[name="variantId"]:checked');
      const price = Number(selected?.dataset.price);
      if (!Number.isFinite(price) || price <= 0) return;
      const compare = Number(selected.dataset.comparePrice || 0);
      document.querySelectorAll(".product-buybox [data-product-price]").forEach((element) => {
        element.textContent = money(price);
      });
      document.querySelectorAll(".product-buybox [data-product-compare]").forEach((element) => {
        const showCompare = Number.isFinite(compare) && compare > price;
        element.textContent = showCompare ? money(compare) : "";
        element.hidden = !showCompare;
      });
    };
    const schedulePriceSync = () => queueMicrotask(syncProductPrice);
    form.querySelector("[data-ga-variant-fieldset]")?.addEventListener("change", schedulePriceSync);
    form.querySelector("[data-ga-variant-fieldset]")?.addEventListener("input", schedulePriceSync);
    schedulePriceSync();
    const submit = form.querySelector(".ga-submit");
    if (submit && formSettings.buttonText) submit.textContent = formSettings.buttonText;
    if (!formSettings.stickyButton) document.querySelectorAll(".ga-popup-trigger--sticky").forEach((element) => element.remove());
    else setTimeout(() => document.querySelectorAll(".ga-popup-trigger--sticky").forEach((element) => {
      if (!formSettings.stickyDesktop) element.classList.add("ga-sticky-mobile-only");
      if (formSettings.stickyPosition === "top") element.classList.add("ga-sticky-top");
    }), 1900);
  }
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initMasadCustomizer, { once: true });
else setTimeout(initMasadCustomizer, 0);
