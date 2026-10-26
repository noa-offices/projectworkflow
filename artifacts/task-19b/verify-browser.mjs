// Runs the real dialog with deterministic in-memory decision actions. No application/database writes.
// node artifacts/task-19b/verify-browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

const out = resolve("artifacts/task-19b");
await mkdir(out, { recursive: true });
const actionStub = `
const state = globalThis.__review = { records: [], loads: 0, saves: [], failSave: false, failLoad: false };
export async function listSupplierPriceDecisions() { state.loads++; if (state.failLoad) throw Error('offline'); return structuredClone(state.records); }
export async function saveSupplierPriceDecisions(rows) {
 state.saves.push(structuredClone(rows));
 if (state.failSave || (state.failSecondBatch && state.saves.length === 2)) throw Error('Decisions could not be saved. Your changes are still here; try again.');
 const result = rows.map((row) => ({...row, id: row.model_code, decided_by: 'manager', decided_by_name: 'Amal Review Manager', decided_at: '2026-10-26T12:00:00Z', updated_by: 'manager', updated_at: '2026-10-26T12:00:00Z'}));
 for (const row of result) { const i = state.records.findIndex(r => r.model_code === row.model_code && r.price_field === row.price_field); if(i < 0) state.records.push(row); else state.records[i] = row; }
 return structuredClone(result);
}`;
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SupplierReviewDialog } from '@/components/products/smart-setup-supplier-review-dialog';
const source = { versionId: '19b00000-0000-0000-0002-000000000001', definitionId: 'd', title: 'October 2026 furniture list', currency: 'EUR', basis: 'list' };
const names = ['Arc task chair', 'Linear workstation', 'Meeting table', 'Storage cabinet', 'Guest chair'];
const params = new URLSearchParams(location.search), large = params.has('large');
const results = Array.from({length: large ? 205 : 5}, (_,i) => ({ locator: 'r'+i, role:'main_product', code:'A'+(i+1), priceField:'unit_price', dimension: '', status: i===3 && !large ? 'NOT_FOUND' : i===4 && !large ? 'NEEDS_REVIEW' : 'MISMATCH', reason: i===3 && !large ? 'no_source_candidate' : i===4 && !large ? 'needs_dimension_mapping' : 'price_differs', importedPrice: 120+i*10, importedCurrency:'EUR', referencePrice: i>=3 && !large ? null : 100, referenceCurrency:'EUR', source, evidence: null }));
const fresh = { fingerprint:'fixture', output:{source,results}, cells:results.map((r,i)=>({ locator:r.locator,label:names[i%5],dimensionLabel:'Standard'})), unsupported:[] };
if (!large) globalThis.__review.records = [{id:'saved', supplier_source_id:source.versionId, supplier_price_list_label:source.title, model_code:'A2',price_field:'unit_price',category:'Standard',imported_price:130,supplier_price:90,currency:'EUR',decision:'use_supplier',custom_price:null,note:null,status:'open',decided_by:'manager',decided_by_name:'Amal Review Manager',decided_at:'2026-10-25T12:00:00Z',updated_by:'manager',updated_at:'2026-10-25T12:00:00Z'}];
if (params.has('loadError')) globalThis.__review.failLoad = true;
function Preview() { const [open,setOpen]=useState(true); return <><h1>Supplier price review — local test fixture</h1><button onClick={()=>setOpen(true)}>Open full review</button>{open && <SupplierReviewDialog fresh={fresh} selected={null} stale={false} canManageDecisions={!params.has('readonly')} onClose={()=>setOpen(false)} initialStatuses={['MISMATCH','NEEDS_REVIEW','NOT_FOUND','MATCHED']}/>}</>; }
createRoot(document.getElementById('root')).render(<Preview/>);`;
const bundle = await build({ stdin: { contents: fixture, loader: "tsx", sourcefile: "review-preview.tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", plugins: [{ name: "mock-decisions", setup(b) { b.onResolve({ filter: /supplier-review-decision-actions$/ }, () => ({ path: "decisions", namespace: "mock" })); b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: actionStub, loader: "js" })); } }] });
const css = await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "../../components/products/smart-setup-supplier-review-dialog.tsx"; @source "../../components/products/supplier-review-decision-controls.tsx"; body { font-family: Arial, sans-serif; background: #f4f4f5; }', { from: resolve(out, "input.css") });
const html = '<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Task 19b test fixture</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script></html>';
const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : req.url === "/style.css" ? "text/css" : "text/html"); res.end(req.url === "/bundle.js" ? bundle.outputFiles[0].text : req.url === "/style.css" ? css.css : html); });
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures = [];
page.on("pageerror", (e) => failures.push(e.message));
const action = (code) => page.locator(`select[aria-label^="Action for ${code} "]:visible`);
const button = (name) => page.getByRole("button", { name, exact: true }).filter({ visible: true });
const text = (value) => page.getByText(value, { exact: true }).filter({ visible: true });
const waitLoaded = () => page.waitForFunction(() => !document.body.innerText.includes('Loading saved decisions'));
const checks = [];
try {
  await page.goto(url); await waitLoaded();
  assert.equal(await action("A2").inputValue(), "use_supplier");
  assert.equal(await text("Price changed, check again").count(), 1);
  assert.equal(await page.locator('select[aria-label^="Action for A4 "]:visible option[value="use_supplier"]').isDisabled(), true);
  await action("A1").selectOption("set_custom");
  await page.locator('input[aria-label^="My price for A1 "]:visible').fill("85");
  await page.locator('tr').filter({ has: page.locator('select[aria-label^="Action for A1 "]') }).getByRole('button', {name:'Add note',exact:true}).click();
  await page.locator('textarea[aria-label^="Note for A1 "]:visible').fill("Confirm the finish with the supplier.");
  assert.equal(await text("1 unsaved change").count(), 1);
  await button("Close").click(); assert.equal(await page.getByRole("alertdialog").count(), 1);
  await button("Keep reviewing").click(); assert.equal(await page.getByRole("alertdialog").count(), 0);
  checks.push("saved decisions load; stale tag; missing supplier disabled; custom price/note; unsaved close confirmation");
  for (const width of [1440,1024,390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    if (width < 1280) {
      await page.getByRole("region", {name:"Supplier price rows"}).evaluate((e) => e.scrollTop = 0);
      const card = page.locator("article").filter({ has: page.locator('select[aria-label^="Action for A1 "]') });
      if (await card.getByRole('button', {name:'Add note',exact:true}).count()) await card.getByRole('button', {name:'Add note',exact:true}).click();
      await card.evaluate((el) => el.scrollIntoView({block:'start'}));
      const bounds = await action("A1").boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
      const noteBounds = await page.locator('textarea[aria-label^="Note for A1 "]:visible').boundingBox(); assert.ok(noteBounds && noteBounds.x + noteBounds.width <= width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.screenshot({ path: resolve(out, `supplier-review-${width}.png`), fullPage: true });
  }
  await button("Save decisions").click(); await text("1 decision saved. Product prices have not changed.").waitFor();
  assert.equal(await page.evaluate(() => globalThis.__review.loads), 1, "saving never reruns the check or reloads decisions");
  await button("Close").click(); await button("Open full review").click(); await waitLoaded();
  assert.equal(await action("A1").inputValue(), "set_custom");
  assert.equal(await page.locator('input[aria-label^="My price for A1 "]:visible').inputValue(), "85");
  checks.push("screenshots at 1440/1024/390; mobile controls fit; save persists through reopen without another check");
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('input[type="checkbox"]').filter({visible:true}).first().check();
  await page.locator('select[aria-label="Bulk action"]:visible').selectOption("check_later"); await button("Apply to selected").click();
  assert.equal(await text("5 unsaved changes").count(), 1);
  await button("Clear").click(); assert.equal(await text("5 selected").count(), 0);
  await button("Check later").click(); assert.equal(await text("Decided 5 of 5 shown").count(), 1);
  await page.evaluate(() => globalThis.__review.failSave = true);
  await button("Save decisions").click(); await page.getByRole("alert").waitFor(); assert.equal(await text("5 unsaved changes").count(), 1);
  await page.evaluate(() => globalThis.__review.failSave = false);
  await button("Save decisions").click(); await text("5 decisions saved. Product prices have not changed.").waitFor();
  checks.push("select all, bulk action, clear selection, decision filter; failed save preserves changes and can retry");
  await page.goto(url); await waitLoaded();
  const staleRow = page.locator('tr').filter({ has: page.locator('select[aria-label^="Action for A2 "]') });
  await staleRow.getByRole('button', {name:'Add note',exact:true}).click();
  await page.locator('textarea[aria-label^="Note for A2 "]:visible').fill('Need to check');
  assert.equal(await text('Price changed, check again').count(),1);
  assert.equal(await text('Decided 0 of 5 shown').count(),1);
  await button('Save decisions').click(); await page.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(() => globalThis.__review.saves.length),0);
  await button('Confirm this decision').click();
  assert.equal(await text('Decided 1 of 5 shown').count(),1);
  await button('Save decisions').click(); await text('1 decision saved. Product prices have not changed.').waitFor();
  checks.push('editing a stale note retains its warning and undecided state; explicit confirmation is required before saving');
  await page.goto(url + '/?large'); await waitLoaded();
  await page.locator('input[type="checkbox"]').filter({visible:true}).first().check();
  await page.locator('select[aria-label="Bulk action"]:visible').selectOption("ignore"); await button("Apply to selected").click();
  await page.evaluate(() => globalThis.__review.failSecondBatch = true);
  await button("Save decisions").click(); await page.getByRole("alert").waitFor();
  assert.deepEqual(await page.evaluate(() => globalThis.__review.saves.map((s) => s.length)), [200,5]);
  assert.equal(await text("5 unsaved changes").count(), 1);
  await button("Save decisions").click(); await text("5 decisions saved. Product prices have not changed.").waitFor();
  assert.deepEqual(await page.evaluate(() => globalThis.__review.saves.map((s) => s.length)), [200,5,5]);
  checks.push("205 selected rows save in 200+5 batches; failure retains only the last 5; retry saves only those");
  await page.goto(url + '/?loadError'); await page.getByRole("alert").waitFor(); assert.equal(await action("A1").isDisabled(), true); assert.equal(await button('Export CSV').isDisabled(),true);
  await page.evaluate(() => globalThis.__review.failLoad = false); await button("Try again").click(); await waitLoaded(); assert.equal(await action("A1").isDisabled(), false);
  await page.goto(url + '/?readonly'); assert.equal(await page.locator('select[aria-label^="Action for"]').count(), 0); assert.equal(await page.evaluate(() => globalThis.__review.loads), 0);
  checks.push("failed load blocks editing until retry; read-only users have no controls and make no decision RPCs");
  assert.deepEqual(failures, []);
  await writeFile(resolve(out,"browser-results.json"), JSON.stringify({ checks, browserErrors:failures, screenshots:[1440,1024,390], fixtureOnly:true }, null, 2));
  console.log(JSON.stringify({checks:checks.length, browserErrors:failures.length, screenshots:[1440,1024,390]}));
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
