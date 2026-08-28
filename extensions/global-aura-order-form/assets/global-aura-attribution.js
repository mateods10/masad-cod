"use strict";

(() => {
  const sessionKey = "global_aura_cart_session";
  const attributionKey = "masad_marketing_attribution";
  const allowed = [
    "utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_term", "utm_content",
    "tt_campaignid", "tt_adgroupid", "tt_creativeid", "ttclid",
  ];
  const sessionId = localStorage.getItem(sessionKey)
    || window.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(sessionKey, sessionId);

  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(attributionKey) || "{}"); } catch { stored = {}; }
  const params = new URL(location.href).searchParams;
  const attribution = { ...stored };
  allowed.forEach((key) => {
    const value = params.get(key);
    if (!attribution[key] && value) attribution[key] = value.slice(0, 255);
  });
  if (!attribution.full_url) attribution.full_url = location.href.slice(0, 2000);
  localStorage.setItem(attributionKey, JSON.stringify(attribution));
  window.GAMarketingAttribution = attribution;

  const modal = document.querySelector(".ga-order-modal[data-ga-proxy]");
  const cartBlock = document.querySelector("[data-ga-cart-checkout][data-ga-proxy]");
  const proxy = modal?.dataset.gaProxy || cartBlock?.dataset.gaProxy;
  if (!proxy) return;

  const root = window.Shopify?.routes?.root || "/";
  fetch(`${root}cart.js`, { headers: { accept: "application/json" } })
    .then((response) => response.ok ? response.json() : null)
    .then((cart) => {
      if (cart?.token) attribution["shopify-cart-token"] = String(cart.token).slice(0, 255);
      localStorage.setItem(attributionKey, JSON.stringify(attribution));
      window.GAMarketingAttribution = attribution;
      return fetch(proxy, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ intent: "capture-attribution", browserSessionId: sessionId, attribution }),
        keepalive: true,
      });
    })
    .catch(() => undefined);
})();
