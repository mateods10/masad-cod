"use strict";

(() => {
  const modal = document.querySelector(".ga-order-modal[data-ga-proxy]");
  if (!modal) return;
  fetch(modal.dataset.gaProxy, { headers: { accept: "application/json" } })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => {
      if (!data?.fraud?.blocked) return;
      document.querySelectorAll(".ga-order-modal, .ga-popup-trigger, #es-popup-button, #es-sticky, .es-popup-button-overwrite")
        .forEach((element) => element.remove());
    })
    .catch(() => {});
})();
