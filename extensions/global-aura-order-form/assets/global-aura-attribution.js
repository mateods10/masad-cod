"use strict";

(() => {
  const sessionKey = "global_aura_cart_session";
  const attributionKey = "masad_marketing_attribution";
  const allowed = [
    "utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_term", "utm_content",
    "tt_campaignid", "tt_adgroupid", "tt_creativeid", "ttclid", "fbclid",
  ];
  const sessionId = localStorage.getItem(sessionKey)
    || window.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(sessionKey, sessionId);

  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(attributionKey) || "{}"); } catch { stored = {}; }
  const params = new URL(location.href).searchParams;
  const hasNewMarketingTouch = allowed.some((key) => params.has(key));
  const attribution = hasNewMarketingTouch ? {} : { ...stored };
  allowed.forEach((key) => {
    const value = params.get(key);
    if (value) attribution[key] = value.slice(0, 255);
  });
  if (!attribution.referrer_url && document.referrer) {
    try {
      const referrer = new URL(document.referrer);
      if (referrer.hostname !== location.hostname) attribution.referrer_url = referrer.href.slice(0, 2000);
    } catch { /* Ignore malformed browser referrers. */ }
  }
  if (hasNewMarketingTouch || !attribution.full_url) attribution.full_url = location.href.slice(0, 2000);
  localStorage.setItem(attributionKey, JSON.stringify(attribution));
  window.GAMarketingAttribution = attribution;

  // A completed order starts a new attribution journey. The order form updates
  // this status element before it reloads the page, so clear the previous touch
  // without coupling the attribution script to the form implementation.
  document.querySelectorAll("[data-ga-status]").forEach((status) => {
    new MutationObserver(() => {
      if (status.dataset.state === "success") localStorage.removeItem(attributionKey);
    }).observe(status, { attributes: true, childList: true, subtree: true });
  });

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
