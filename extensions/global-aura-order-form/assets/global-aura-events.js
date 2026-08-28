"use strict";

(() => {
  // Tracking is intentionally server-side. Keeping this tiny asset preserves
  // compatibility with themes that already import it without loading vendor pixels.
  window.__gaMasadPixels = true;
  document.documentElement.dataset.gaEvents = "server";
})();
