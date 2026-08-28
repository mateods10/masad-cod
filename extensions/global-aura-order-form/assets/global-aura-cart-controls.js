"use strict";

(() => {
  const hiddenClass = "ga-cart-quantity-hidden";
  const cartScope = (element) => element.closest([
    "[data-cart-item]",
    "[data-cart-line]",
    "[class*='cart-item']",
    "[class*='cart_item']",
    "[class*='cart-drawer']",
    "cart-items",
    "cart-drawer-items",
  ].join(","));
  const controlText = (element) => [
    element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("name"),
    element.getAttribute("data-action"), element.className, element.textContent,
  ].filter(Boolean).join(" ").toLowerCase();
  const isRemoveControl = (element) => /remove|delete|trash|eliminar|borrar|basurero/.test(controlText(element));
  const hide = (element) => {
    element.classList.add(hiddenClass);
    element.setAttribute("aria-hidden", "true");
    element.tabIndex = -1;
  };

  const hideQuantityControls = () => {
    // Dawn y la mayoría de temas encierran + / − / cantidad en quantity-input.
    document.querySelectorAll("quantity-input, [data-quantity-selector], .quantity-selector, .cart-item__quantity").forEach((element) => {
      if (cartScope(element) && !element.querySelector("[data-cart-remove], cart-remove-button, [class*='remove'], [class*='delete']")) hide(element);
    });

    document.querySelectorAll("input[type='number'], input[name*='updates'], input[name*='quantity']").forEach((input) => {
      if (cartScope(input)) hide(input.closest(".quantity__input-wrapper, .quantity-input-wrapper") || input);
    });

    document.querySelectorAll("button, a").forEach((control) => {
      if (!cartScope(control) || isRemoveControl(control)) return;
      const text = controlText(control).replace(/\s+/g, " ").trim();
      const isQuantityAction = /minus|plus|decrease|increase|increment|decrement|quantity.*(?:up|down)|(?:up|down).*quantity/.test(text)
        || /^[+\-−]$/.test((control.textContent || "").trim())
        || Boolean(control.querySelector("[class*='plus'], [class*='minus'], [data-icon='plus'], [data-icon='minus']"));
      if (isQuantityAction) hide(control);
    });
  };

  const start = () => {
    hideQuantityControls();
    new MutationObserver(hideQuantityControls).observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
