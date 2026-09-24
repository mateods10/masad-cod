"use strict";
(() => {
  if (window.GAWhatsappConfirmation) return;
  const phoneInput = element => element?.matches?.('.ga-order-modal [name="phone"],.ga-cart-order-modal [name="phone"]');
  document.addEventListener("input", event => {
    if (!phoneInput(event.target)) return;
    event.target.setCustomValidity("");
  }, true);
  document.addEventListener("focusout", event => {
    const input = event.target;
    if (!phoneInput(input)) return;
    const raw = input.value.trim();
    const digits = raw.replace(/\D/g, "");
    const valid = /^\+?[\d\s().-]+$/.test(raw) && (!raw.startsWith("+") || digits.startsWith("593")) && /^(?:593|0)?9\d{8}$/.test(digits);
    input.setCustomValidity(raw && !valid ? "Ingresa un celular de Ecuador: 09 seguido de 8 números, o +5939 seguido de 8 números." : "");
    if (valid) input.value = "+593" + digits.slice(-9);
  }, true);
  // A completed form must not create a second order if Enter is pressed again.
  document.addEventListener("submit", event => {
    if (event.target.dataset.gaWhatsappCompleted) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.GAWhatsappConfirmation = {
    async open(proxy, result, modal) {
      if (!result.whatsappConfirmationToken) return false;
      const form = modal.querySelector("form");
      if (form) {
        form.dataset.gaWhatsappCompleted = "true";
        form.querySelectorAll("input,select,textarea,.ga-submit").forEach(input => { input.disabled = true; });
      }
      let panel = modal.querySelector(".ga-whatsapp-confirmation");
      if (panel) return true;
      panel = document.createElement("section"); panel.className = "ga-whatsapp-confirmation";
      const note = document.createElement("p"); note.setAttribute("role", "status");
      const link = document.createElement("a"); link.textContent = "CONFIRMAR POR WHATSAPP"; link.hidden = true; link.rel = "noreferrer";
      const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Reintentar abrir WhatsApp"; retry.hidden = true;
      const next = document.createElement("button"); next.type = "button"; next.textContent = "HACER OTRO PEDIDO";
      next.addEventListener("click", () => location.reload());
      panel.append(note, link, retry, next);
      (form || modal).append(panel);
      const load = async () => {
        retry.hidden = true; link.hidden = true;
        note.textContent = "Tu pedido está registrado. Preparando el resumen final…";
        try {
          const response = await fetch(proxy, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ intent: "whatsapp-confirmation", token: result.whatsappConfirmationToken }), signal: AbortSignal.timeout(15000) });
          const data = await response.json();
          if (!response.ok || data.error) throw new Error(data.error || "No se pudo preparar WhatsApp.");
          if (!data.enabled) { note.textContent = "Tu pedido está registrado. Te contactaremos pronto."; return; }
          const url = new URL(data.url);
          if (url.origin !== "https://wa.me") throw new Error("Enlace de WhatsApp inválido.");
          link.href = url.href; link.hidden = false;
          note.textContent = "Tu pedido está registrado. Abre WhatsApp, revisa el resumen y pulsa Enviar. Si no se abrió, usa este botón.";
          location.assign(url.href);
        } catch (error) {
          note.textContent = "Tu pedido está registrado. No pudimos abrir WhatsApp. Puedes reintentarlo sin repetir la compra.";
          retry.hidden = false;
        }
      };
      retry.addEventListener("click", load);
      await load();
      return true;
    },
  };
})();
