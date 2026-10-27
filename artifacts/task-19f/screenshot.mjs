// Renders the real review dialog with local saved-decision fixtures.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

const out = resolve("artifacts/task-19f"); await mkdir(out, { recursive: true });
const fixture = `
import React from 'react';import{createRoot}from'react-dom/client';import{SupplierReviewDialog}from'@/components/products/smart-setup-supplier-review-dialog';
const source={versionId:'19b00000-0000-0000-0002-000000000001',definitionId:'d',title:'October 2026 furniture list',currency:'EUR',basis:'list'};
const results=['A1','A2','A3'].map((code,i)=>({locator:code,role:'main_product',code,priceField:'unit_price',dimension:'',status:'MISMATCH',reason:'price_differs',importedPrice:120+i*10,importedCurrency:'EUR',referencePrice:100,referenceCurrency:'EUR',source,evidence:null}));
const fresh={fingerprint:'19f',output:{source,results},cells:results.map((r,i)=>({locator:r.locator,label:['Arc task chair','Linear workstation','Meeting table'][i],dimensionLabel:'Standard'})),unsupported:[]};
createRoot(document.getElementById('root')).render(<SupplierReviewDialog fresh={fresh} stale={false} selected={null} canManageDecisions={true} onClose={()=>{}}/>);`;
const actions = `const record=(code,over={})=>({id:code,supplier_source_id:'19b00000-0000-0000-0002-000000000001',supplier_price_list_label:'October 2026 furniture list',model_code:code,price_field:'unit_price',category:'Standard',imported_price:120,supplier_price:100,currency:'EUR',decision:'keep_imported',custom_price:null,note:null,status:'open',decided_by:'u',decided_at:'2026-10-27T10:00:00Z',updated_by:'u',updated_at:'2026-10-27T10:00:00Z',decided_by_name:'Manager',...over});
export async function listSupplierPriceDecisions(){return [record('A1'),record('A3')];}
export async function saveSupplierPriceDecisions(rows){return rows.map(r=>record(r.model_code,r));}`;
const bundle = await build({ stdin: { contents: fixture, loader: "tsx", sourcefile: "review-19f.tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", plugins: [{ name: "stub-decision-actions", setup(b) { b.onResolve({ filter: /supplier-review-decision-actions$/ }, () => ({ path: "stub", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: actions, loader: "js" })); } }] });
const css = await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "../../components/products/smart-setup-supplier-review-dialog.tsx"; @source "../../components/products/supplier-review-decision-controls.tsx"; body { font-family: Arial, sans-serif; }', { from: resolve(out, "input.css") });
const html = '<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Task 19f</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script></html>';
const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : req.url === "/style.css" ? "text/css" : "text/html"); res.end(req.url === "/bundle.js" ? bundle.outputFiles[0].text : req.url === "/style.css" ? css.css : html); });
await new Promise(done => server.listen(0, "127.0.0.1", done)); const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(`http://127.0.0.1:${server.address().port}`);
  const dialog = page.getByRole("dialog", { name: "Supplier price review" });
  await dialog.getByText("Showing 1 of 3 rows (2 reviewed hidden)").first().waitFor();
  assert.equal(await dialog.locator("table tbody tr").count(), 1);
  await page.screenshot({ path: resolve(out, "reviewed-hidden-1440.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Show reviewed (2)" }).click();
  assert.equal(await dialog.locator("table tbody tr").count(), 3);
  assert.equal(await dialog.locator("table tbody span:has-text('Reviewed')").count(), 2);
  await page.screenshot({ path: resolve(out, "reviewed-shown-1440.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Show reviewed (2)" }).click();
  await dialog.getByRole("button", { name: "Decided", exact: true }).click();
  assert.equal(await dialog.locator("table tbody tr").count(), 2, "Decided chip reveals reviewed rows");
  await dialog.getByRole("button", { name: "Decided", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "Select A2 Standard" }).check();
  await dialog.getByRole("combobox", { name: "Action for A2 Standard" }).selectOption("keep_imported");
  await dialog.getByRole("button", { name: "Save decisions" }).click();
  await dialog.getByText("Showing 0 of 3 rows (3 reviewed hidden)").first().waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Save decisions");
  assert.equal(await dialog.getByText(/\d+ selected/).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await dialog.getByRole("button", { name: "Show reviewed (3)" }).count(), 1);
  const fitsMobile = await dialog.locator('div[aria-live="polite"]:visible').evaluate((line) => {
    const count = line.querySelector('span'), toggle = line.querySelector('button');
    return !!count && !!toggle && count.getBoundingClientRect().right <= innerWidth && toggle.getBoundingClientRect().right <= innerWidth;
  });
  assert.ok(fitsMobile, "count and toggle fit within 390 px");
  await dialog.getByRole("button", { name: "Show reviewed (3)" }).click();
  assert.equal(await dialog.locator("article").count(), 3);
  console.log("1440 screenshots captured; hide/show, save focus, deselection and 390 px toggle passed.");
} finally { await browser.close(); await new Promise(done => server.close(done)); }
