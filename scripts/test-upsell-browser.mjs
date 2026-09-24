import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.BROWSER_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const offers = [1, 2].map(id => ({ id: String(id), campaignId: 'test', product: { title: `Producto adicional ${id}`, image: '' }, variantTitle: 'Default Title', price: 20, discountPercent: 10, finalPrice: 18, headline: 'Completa tu pedido' }));
  let accepts = 0;
  await page.route('https://upsell.test/**', async route => {
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON();
      if (data.intent === 'accept-post-upsell') accepts++;
      await route.fulfill({ json: data.intent === 'accept-post-upsell' ? { ok: true, total: 48 } : { offers } });
    } else await route.fulfill({ contentType: 'text/html', body: '<html><head></head><body><button id="start">Comprar</button></body></html>' });
  });
  await page.goto('https://upsell.test/');
  await page.addStyleTag({ content: readFileSync('extensions/global-aura-order-form/assets/global-aura-upsells.css', 'utf8') });
  await page.addScriptTag({ content: readFileSync('extensions/global-aura-order-form/assets/global-aura-upsells.js', 'utf8') });
  await page.evaluate(() => { window.testResult = window.GAUpsells.pre('/cart', { lines: [{ variantId: 1 }] }); });
  await page.getByRole('dialog').waitFor();
  mkdirSync('preview', { recursive: true });
  await page.screenshot({ path: 'preview/upsell-mobile.png' });
  await page.getByRole('button', { name: /Sí, agregar/ }).click();
  await page.getByText('Producto adicional 2', { exact: true }).waitFor();
  await page.getByRole('button', { name: /No, gracias/ }).click();
  const selected = await page.evaluate(() => window.testResult);
  assert.deepEqual(selected, [{ campaignId: 'test', offerId: '1', expectedPrice: 18 }]);
  assert.equal(accepts, 0);
  await page.evaluate(() => { window.testResult = window.GAUpsells.post('/cart', { postUpsellToken: 'mock-only' }); });
  await page.getByRole('button', { name: /Sí, agregar/ }).click();
  await page.getByText('Producto adicional 2', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.testResult), 48);
  assert.equal(accepts, 1);
  assert.equal(await page.locator('dialog').count(), 0);
  console.log('Browser checks passed: sequential offers, accept, reject, Escape, post-purchase total, one API acceptance.');
} finally { await browser.close(); }
