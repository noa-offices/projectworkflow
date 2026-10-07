import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const url = new URL("./supplier-history-actions.tsx", import.meta.url);
const source = await readFile(url, "utf8");
const output = ts.transpileModule(source, { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const compiled = { exports: {} };
const dependencies: Record<string, unknown> = {
  "next/link": { default: ({ children, ...props }: { children: React.ReactNode }) => React.createElement("a", props, children) },
  "next/navigation": { useRouter: () => ({ refresh() {} }) },
  "@/app/products/price-updates/supplier-sources/actions": {},
  "./supplier-price-workspace-controls": { SupplierArchiveButton: () => React.createElement("button", null, "Archive") },
};
new Function("require", "module", "exports", output)((name: string) => dependencies[name] ?? createRequire(url)(name), compiled, compiled.exports);
const { SupplierHistoryActions, SupplierLeaveReviewButton, historyMenuPosition } = compiled.exports as typeof import("./supplier-history-actions.js");

test("History uses the native top layer, preserves View/Download, and gates destructive archived actions", () => {
  const props = { sourceId: "s", title: "Test", viewHref: "/view", downloadUrl: "https://example.test/file", archived: true, canArchive: true, canUnarchive: true, canPermanentlyDelete: true };
  const html = (extra = {}) => renderToStaticMarkup(React.createElement(SupplierHistoryActions, { ...props, ...extra }));
  assert.match(html(), /popover="auto"/); assert.match(html(), /role="dialog"/); assert.match(html(), /fixed z-\[100\] m-0/);
  assert.match(html(), /href="\/view"[^>]*>View/); assert.match(html(), />Download<\/a>/); assert.match(html(), /text-red-800[^>]*>Permanently delete/);
  assert.doesNotMatch(html({ canPermanentlyDelete: false }), /Permanently delete/);
  assert.match(html(), />Unarchive<\/button>/); assert.doesNotMatch(html({ canUnarchive: false }), />Unarchive<\/button>/);
  assert.match(html({ deleteBlockedReason: "Leave all open reviews first." }), /disabled=""[^>]*title="Leave all open reviews first\."/);
  assert.doesNotMatch(html({ archived: false }), /Permanently delete/); assert.match(html({ archived: false }), />Archive<\/button>/);
  assert.match(source, /window\.confirm\("Permanently delete this archived Supplier price list\?\\nThis cannot be undone\."\)/);
});

test("Leave review confirmation names the preserved Product outcomes and offers Cancel / Leave review", () => {
  const html = renderToStaticMarkup(React.createElement(SupplierLeaveReviewButton, { batchId: "b" }));
  assert.match(html, /<dialog/); assert.match(html, /Leave this Supplier review\?/);
  assert.match(html, /Unfinished review work will be abandoned\./);
  assert.match(html, /Prices already applied or recorded in Product history will not be changed\./);
  assert.match(html, />Cancel<\/button>/); assert.match(html, />Leave review<\/button>/);
});

test("bottom-row menus flip above and horizontal positioning stays inside the viewport", () => {
  assert.deepEqual(historyMenuPosition({ right: 390, top: 560, bottom: 592 }, { width: 208, height: 140 }, { width: 400, height: 600 }), { left: 182, top: 416 });
  assert.deepEqual(historyMenuPosition({ right: 40, top: 10, bottom: 42 }, { width: 208, height: 140 }, { width: 400, height: 600 }), { left: 8, top: 46 });
});

// Opt-in real-browser component QA: no Next build, live requests or database mutation.
test("native History popup escapes a clipped bottom-row card, focuses View, dismisses and confirms explicitly", { skip: !process.env.SUPPLIER_HISTORY_BROWSER_TEST }, async () => {
  const { build } = await import("esbuild");
  const { chromium } = await import("playwright");
  const stubs: Record<string, string> = {
    "next/link": 'import React from "react"; export default function Link(p){return React.createElement("a",p,p.children)}',
    "next/navigation": 'export function useRouter(){return {refresh(){window.refreshed=true}}}',
    "@/app/products/price-updates/supplier-sources/actions": 'export async function permanentlyDeleteSupplierSource(){window.deleted=true;return {warning:""}} export async function unarchiveSupplierSource(){window.restored=true} export async function leaveSupplierReview(){window.left=true}',
    "./supplier-price-workspace-controls": 'export function SupplierArchiveButton(){return null}',
  };
  const bundle = await build({ write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {SupplierHistoryActions,SupplierLeaveReviewButton} from "./components/products/supplier-history-actions"; createRoot(document.getElementById("root")).render(<><SupplierHistoryActions sourceId="s" title="Test" viewHref="#view" downloadUrl="#file" archived={true} canArchive={true} canUnarchive={true} canPermanentlyDelete={true}/><SupplierLeaveReviewButton batchId="b"/></>);' },
    plugins: [{ name: "local-mocks", setup(plugin) {
      plugin.onResolve({ filter: /^(next\/|@\/app\/|\.\/supplier-price-workspace-controls)/ }, (args) => args.path in stubs ? { path: args.path, namespace: "mock" } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: stubs[args.path], resolveDir: process.cwd(), loader: "js" }));
    } }],
  });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
    await page.setContent('<style>#card{position:absolute;top:530px;left:300px;width:260px;height:50px;overflow:hidden} [popover]{position:fixed;margin:0;width:208px;padding:8px} [popover] a,[popover] button{display:block;height:28px}</style><button id="outside">Outside</button><div id="card"><div id="root"></div></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const trigger = page.getByRole("button", { name: "Actions for Test" });
    await trigger.click();
    const menu = page.getByRole("dialog");
    await menu.waitFor({ state: "visible" });
    const rect = await menu.boundingBox(); assert.ok(rect && rect.y >= 8 && rect.y + rect.height <= 592);
    assert.ok(rect.y < 530, "bottom menu flips above the clipped card");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "View");
    assert.equal(await menu.evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + 20, r.y + 15)); }), true, "popup is hit-testable outside the ancestor overflow");
    await page.keyboard.press("Escape"); await menu.waitFor({ state: "hidden" }); assert.equal(await trigger.evaluate((el) => document.activeElement === el), true);
    await trigger.click(); await page.locator("#outside").click(); await menu.waitFor({ state: "hidden" });
    await trigger.click();
    page.once("dialog", async (dialog) => { assert.equal(dialog.message(), "Permanently delete this archived Supplier price list?\nThis cannot be undone."); await dialog.dismiss(); });
    await page.getByRole("button", { name: "Permanently delete", exact: true }).click(); assert.equal(await page.evaluate(() => "deleted" in window), false);
    page.once("dialog", async (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Permanently delete", exact: true }).click();
    await page.waitForFunction(() => "refreshed" in window);
    assert.equal(await page.evaluate(() => "deleted" in window), true);
    await page.getByRole("button", { name: "Leave review", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Leave this Supplier review?", exact: true });
    await confirmation.waitFor({ state: "visible" });
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.evaluate(() => "left" in window), false);
    await page.getByRole("button", { name: "Leave review", exact: true }).click();
    await confirmation.getByRole("button", { name: "Leave review", exact: true }).click();
    await page.waitForFunction(() => "left" in window);
    await trigger.click(); await page.getByRole("button", { name: "Unarchive", exact: true }).click();
    await page.waitForFunction(() => "restored" in window);
  } finally { await browser.close(); }
});
