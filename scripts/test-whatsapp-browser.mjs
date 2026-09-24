import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.BROWSER_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let fail = false; let sends = 0; const intents = [];
  await page.route('https://wa.me/**', async route => { sends++; await route.fulfill({ contentType: 'text/html', body: '<p>WhatsApp simulado: el cliente debe pulsar Enviar.</p>' }); });
  await page.route('https://confirmation.test/**', async route => {
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON(); intents.push(data.intent);
      await route.fulfill({ status: fail ? 400 : 200, json: fail ? { error: 'temporary' } : data.intent === 'post-upsells' ? { offers: [] } : { enabled: true, url: 'https://wa.me/593984578367?text=Pedido%20de%20prueba' } });
    } else await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><head><meta charset="utf-8"></head><body style="font-family:Arial;margin:16px"><div class="ga-order-modal" style="--ga-button-bg:#153f50;--ga-button-text:white"><h2>Confirma tu pedido</h2><form><label>Celular<input name="phone" type="tel"></label><label class="ga-consent"><input type="checkbox" name="consentWhatsapp" required><span>🔒 <strong>Importante:</strong> Confirmaré mi pedido y acepto recibir por WhatsApp información relacionada con esta compra.</span></label><button class="ga-submit">PAGA AL RECIBIR</button><p data-ga-status></p><p data-ga-total></p></form></div></body></html>' });
  });
  const setup = async () => {
    await page.goto('https://confirmation.test/');
    await page.addStyleTag({ content: readFileSync('extensions/global-aura-order-form/assets/global-aura-whatsapp.css', 'utf8') });
    for (const file of ['global-aura-whatsapp.js', 'global-aura-upsells.js']) await page.addScriptTag({ content: readFileSync(`extensions/global-aura-order-form/assets/${file}`, 'utf8') });
  };
  await setup();
  const input = page.locator('[name=phone]');
  await input.fill('+57 315 0032206'); await input.blur();
  assert.equal(await input.evaluate(e => e.checkValidity()), false);
  await input.fill('098 457 8367'); await input.blur();
  assert.equal(await input.inputValue(), '+593984578367');
  assert.equal(await page.locator('input[type=checkbox]').count(), 1);
  assert.equal(await page.locator('input[type=checkbox]').isChecked(), false);
  mkdirSync('preview', { recursive: true });
  await page.screenshot({ path: 'preview/whatsapp-consent-mobile.png' });
  fail = true;
  await page.evaluate(() => window.GAUpsells.finish('/cart', { orderTotal: 42, orderName: '#1001', whatsappConfirmationToken: 'mock', postUpsellToken: 'mock' }, document.querySelector('.ga-order-modal')));
  assert.deepEqual(intents, ['post-upsells', 'whatsapp-confirmation']);
  await page.getByRole('button', { name: 'Reintentar abrir WhatsApp' }).waitFor();
  assert.equal(await page.locator('.ga-submit').isVisible(), false);
  assert.equal(await page.evaluate(() => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))), false);
  await page.screenshot({ path: 'preview/whatsapp-confirmation-mobile.png' });
  fail = false;
  await page.getByRole('button', { name: 'Reintentar abrir WhatsApp' }).click();
  await page.waitForURL('https://wa.me/**');
  assert.equal(intents.filter(i => i === 'place-cod').length, 0);
  assert.equal(page.url(), 'https://wa.me/593984578367?text=Pedido%20de%20prueba');
  assert.equal(sends, 1); // Navigation only, no WhatsApp send API.
  await setup();
  assert.equal(await page.evaluate(() => window.GAUpsells.finish('/cart', { orderTotal: 42 }, document.querySelector('.ga-order-modal'))), false);
  console.log('WhatsApp browser checks passed: one unchecked consent, phone validation, post-upsell ordering, fallback/retry, no duplicate order, disabled-store behavior.');
} finally { await browser.close(); }
