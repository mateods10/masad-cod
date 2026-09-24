import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.BROWSER_TEST_MODULES, 'package.json'));
const { chromium } = require('playwright');
const esbuild = createRequire(import.meta.url)('../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild');
const output = await esbuild.build({
  stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import Upsells from "./app/routes/app.upsells.tsx"; createRoot(document.getElementById("root")).render(<Upsells/>);', resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, write: false, outfile: 'preview/editor.js', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'editor-test-boundaries', setup(build) {
    build.onLoad({ filter: /app\.upsells\.tsx$/ }, args => ({ contents: readFileSync(args.path, 'utf8').replace(/export const loader =[\s\S]*?(?=const money =)/, ''), loader: 'tsx' }));
    build.onResolve({ filter: /^(react-router|@shopify\/app-bridge-react)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'jsx', resolveDir: process.cwd(), contents: args.path === 'react-router' ? `
      import React from 'react';
      export const Link=({to,children,...props})=><a href={to} {...props}>{children}</a>;
      export const Form=({children,...props})=><form {...props} onSubmit={e=>e.preventDefault()}>{children}</form>;
      export const useLoaderData=()=>({campaigns:[],canPost:true});
      export const useActionData=()=>undefined;
      export const useNavigation=()=>({state:'idle'});
      export const useSearchParams=()=>[new URLSearchParams('edit=new')];
    ` : `export const useAppBridge=()=>({resourcePicker:async options=>[{id:'gid://shopify/Product/'+(options.multiple?1:2),title:options.multiple?'Producto principal':'Producto adicional',images:[],variants:[{id:'gid://shopify/ProductVariant/2',title:'Una unidad',price:'20.00'}]}],scopes:{request:async()=>{}}});` }));
  } }],
});
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:1300,height:1000}});
  await page.route('https://editor.test/**',r=>r.fulfill({contentType:'text/html',body:'<html><body style="background:#f4f4f4;padding:20px"><div id="root"></div></body></html>'}));
  await page.goto('https://editor.test/');
  for(const file of output.outputFiles) {
    if(file.path.endsWith('.css')) await page.addStyleTag({content:file.text});
    else await page.addScriptTag({content:file.text});
  }
  await page.getByRole('button',{name:'Seleccionar productos (0)'}).click();
  await page.getByRole('button',{name:'Seleccionar producto',exact:true}).click();
  assert.equal(await page.getByText('Producto principal',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Post-compra',exact:true}).click();
  assert.match(await page.locator('input[name=campaign]').inputValue(),/"mode":"POST"/);
  await page.getByLabel('Descuento (%)').fill('25');
  assert.equal((await page.locator('.mu-preview .mu-price strong').textContent()).replace(/\s/g,''),'$15,00');
  mkdirSync('preview',{recursive:true});
  await page.screenshot({path:'preview/upsell-editor-desktop.png',fullPage:true});
  for(let i=0;i<4;i++) await page.getByRole('button',{name:/Agregar oferta/}).click();
  assert.equal(await page.getByRole('button',{name:/Agregar oferta/}).isDisabled(),true);
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  console.log('Editor checks passed: manual trigger/product selection, post-purchase mode, discount preview, five-offer limit, mobile layout.');
} finally {await browser.close();}
