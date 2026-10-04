import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { friendlyPriceHealth } from "../../lib/product-price-check.js";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
async function load<T>(path: string, dependencies: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(path, import.meta.url);
  const output = ts.transpileModule(await read(path), { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => Object.hasOwn(dependencies, name) ? dependencies[name] : createRequire(url)(name.startsWith("@/") ? fileURLToPath(new URL(`../../${name.slice(2)}`, import.meta.url)) : name), compiled, compiled.exports);
  return compiled.exports as T;
}
type Component = (props: Record<string, unknown>) => React.ReactElement | null;
const common = {
  "next/link": { default: ({ children, ...props }: { children: unknown }) => React.createElement("a", props, children as never) }, "next/navigation": { useRouter() { return { refresh() {}, push() {} }; } },
  "@/lib/supabase/client": { createClient() { assert.fail("no client"); } }, "@/app/products/price-updates/supplier-sources/actions": {},
};
const family = await load<Record<"SupplierFamilyList" | "SupplierFamilyTable" | "SupplierBrandProgress", Component>>("./supplier-family-review.tsx", common);
const controls = await load<Record<"SupplierAdvancedImportSettings" | "SupplierCompletionControls", Component>>("./supplier-price-workspace-controls.tsx", common);
const workflow = await load<Record<"SupplierTabs" | "SupplierWorkflowHeader" | "SupplierCompleteSummary" | "SupplierFinishScreen", Component>>("./supplier-price-workflow.tsx", { ...common, "@/components/products/supplier-price-workspace-controls": controls });
const wizard = await load<Record<"SupplierImportFormatWizard", Component>>("./supplier-import-format-wizard.tsx", common);
const html = (component: Component, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(component as never, props as never));

const primaryClass = /bg-emerald-900[^"]*text-white/;
const fam = (name: string, status: string, extra: Record<string, unknown> = {}) => ({ template_id: name, template_name: name, items: 10, changed: 0, same: 0, missing: 0, attention: 0, done: 0, excluded: 0, status, ...extra });
const overview = { batch: { id: "r", status: "review", scope: "complete" }, supplierOnly: { unmatched: 3401, companions: 0 }, finished: { applied: 12, confirmed: 77, excluded: 4 },
  families: [fam("LEAD", "ready", { done: 10 }), fam("MONOLITH", "needs_review", { changed: 4, same: 54, missing: 2 }), fam("OXI_P", "needs_attention", { attention: 1 }), fam("DONE", "completed")],
  totals: { families: 4, ready: 2, changed: 4, same: 54, missing: 2, attention: 1 } };
const links = overview.families.map((item) => ({ template_id: item.template_id, href: `/f/${item.template_id}` }));
const source = { id: "s", title: "LAS MOBILI — February 2026", currency: "EUR", basis: "list", status: "imported" };

test("tabs and stepper are real navigation with strong active states", () => {
  const tabs = html(workflow.SupplierTabs, { tab: "import", hrefs: { current: "/c", import: "/i", history: "/h" } });
  assert.match(tabs, /aria-current="page"[^>]*>Import new/); assert.match(tabs, /class="[^"]*bg-emerald-900[^"]*text-white[^"]*"[^>]*>Import new|aria-current="page" class="[^"]*bg-emerald-900/);
  assert.match(tabs, /hover:bg-zinc-100/); assert.match(tabs, /focus-visible:outline/); assert.doesNotMatch(tabs, /border-b-2/);
  const header = html(workflow.SupplierWorkflowHeader, { brandName: "LAS MOBILI", source, batch: { scope: "complete" }, step: 2, links: { steps: ["/1", "/2", "/3"], history: "#history", advanced: "#advanced" } });
  assert.match(header, /✓<\/span> 1 Import/); assert.match(header, /bg-emerald-50[^"]*text-emerald-900[^>]*>.*1 Import/); // completed = green
  assert.match(header, /aria-current="step"[^>]*>[\s\S]*●[\s\S]*2 Family Review/); assert.match(header, /bg-emerald-900[^"]*text-white[^>]*>[\s\S]*2 Family Review|2 Family Review/);
  assert.match(header, /text-zinc-500[^>]*>[\s\S]*○[\s\S]*3 Complete/); // upcoming = muted
  assert.match(header, />Price list history<\/a>/); assert.match(header, />Advanced tools<\/a>/); assert.match(header, /rounded-lg border border-zinc-200 bg-white shadow-sm/); // one compact header card with real buttons
});

test("progress cards: five same-height cards, meaningful colors, no duplicate row in the Family list", () => {
  const progress = html(family.SupplierBrandProgress, { overview });
  for (const label of ["Families ready", "Changed remaining", "Same to confirm", "Missing to review", "Needs attention"]) assert.match(progress, new RegExp(`<dt[^>]*>${label}</dt>`), label);
  assert.match(progress, /Families ready<\/dt><dd[^>]*>2 \/ 4/); assert.equal((progress.match(/min-h-\[5\.5rem\]/g) ?? []).length, 5);
  assert.match(progress, /border-emerald-200 bg-emerald-50[^"]*"><dt[^>]*>Families ready/); assert.match(progress, /border-red-200 bg-red-50[^"]*"><dt[^>]*>Needs attention/); assert.match(progress, /border-amber-200 bg-amber-50[^"]*"><dt[^>]*>Same to confirm/);
  const quiet = html(family.SupplierBrandProgress, { overview: { ...overview, totals: { ...overview.totals, attention: 0, same: 0, missing: 0 } } });
  assert.doesNotMatch(quiet, /border-red-200/); assert.doesNotMatch(quiet, /Same to confirm<\/dt><dd[^>]*>0<\/dd>[\s\S]*border-amber/);
  const list = html(family.SupplierFamilyList, { overview, links, advancedHref: "/adv", supplierOnlyHref: "/so", continueHref: "/complete" });
  assert.doesNotMatch(list, /Same to confirm|Missing to review|Changed remaining/); // the counts live in the progress cards only
});

test("Family table: status badges with text, Review family buttons, Continue to Complete as the primary action", () => {
  const list = html(family.SupplierFamilyList, { overview, links, advancedHref: "/adv", supplierOnlyHref: "/so", continueHref: "/complete" });
  for (const [label, tone] of [["Ready", "emerald"], ["Needs review", "amber"], ["Needs attention", "red"], ["Completed", "emerald"]]) assert.match(list, new RegExp(`border-${tone}-200[^"]*text-${tone}-900[^>]*>(<span[^>]*>.</span>)?${label}<`), label); // never color alone
  assert.equal((list.match(/aria-label="Review family [A-Z_]+"/g) ?? []).length, 4); assert.match(list, /<a[^>]*class="[^"]*h-8[^"]*border[^"]*"[^>]*aria-label="Review family LEAD"[^>]*>Review family<\/a>|aria-label="Review family LEAD"/);
  assert.match(list, /<a[^>]*href="\/complete"[^>]*class="[^"]*bg-emerald-900[^"]*text-white[^"]*"[^>]*>Continue to Complete Review<\/a>|class="[^"]*bg-emerald-900[^"]*"[^>]*href="\/complete"[^>]*>Continue to Complete Review/);
  assert.match(list, /bg-zinc-50/); assert.match(list, /hover:bg-zinc-50/); assert.match(list, /tabular-nums/); assert.match(list, /<th scope="row"[^>]*font-semibold[^>]*>MONOLITH/);
  assert.match(list, /Advanced \/ Technical Review/); assert.doesNotMatch(list.match(/<a[^>]*>Advanced \/ Technical Review<\/a>/)?.[0] ?? "", primaryClass); // secondary, not competing
  assert.match(list, /<details[^>]*>[\s\S]*Supplier-only items: 3,401[\s\S]*Informational only — not part of Product review[\s\S]*View in Advanced Review/); assert.doesNotMatch(list, /<details[^>]* open/);
  assert.doesNotMatch(list, /target_not_represented|baseline_drift|invalid_source|pricing_version/);
});

test("Family detail: tab buttons with counts, selectable table, attention rows with plain issues", async () => {
  const rows = [{ key: "k", code: "103801", item: "160 / melamine", current: "EUR 92", supplier: "EUR 81", change: "-11", issue: "", action: "", classification: "decreased", selectable: true }];
  const tabs = [["changed", "Changed", 4], ["same", "Same", 54], ["missing", "Missing", 2], ["attention", "Needs attention", 1]].map(([section, label, count]) => ({ section, label, count, href: `/t/${section}` }));
  const table = html(family.SupplierFamilyTable, { batchId: "r", familyName: "MONOLITH", section: "changed", tabs, rows, truncated: false, approver: true, batchOpen: true, limit: 50, backHref: "/b", detailsHref: "/d" });
  assert.match(table, /aria-current="page"[^>]*>Changed<span[^>]*>4<\/span>/); assert.match(table, /Same<span[^>]*>54<\/span>/); assert.match(table, /Missing<span[^>]*>2<\/span>/); assert.match(table, /Needs attention<span[^>]*>1<\/span>/);
  assert.match(table, /type="checkbox"[^>]*aria-label|aria-label="Select 103801 160 \/ melamine"/); assert.match(table, />Select all</); assert.match(table, />Clear selection</); assert.match(table, /4 Changed · 54 Same · 2 Missing · 1 Needs attention/);
  assert.doesNotMatch(table, /k"|architecture|row_id|group_id|target key|provenance/i);
  const attention = html(family.SupplierFamilyTable, { batchId: "r", familyName: "MONOLITH", section: "attention", tabs, rows: [{ ...rows[0], issue: "Source data problem", action: "Check the Supplier source row in Advanced Review", classification: "invalid_source", selectable: false }], truncated: false, approver: true, batchOpen: true, limit: 50, backHref: "/b", detailsHref: "/d?x=1" });
  assert.match(attention, /⚠<\/span>Source data problem/); assert.match(attention, />Review details<\/a>/); assert.doesNotMatch(attention, /type="checkbox"/);
  // The bulk bar appears only with a selection, sticks to the bottom, and has a filled primary action plus Clear.
  const source = await read("./supplier-family-review.tsx");
  assert.match(source, /sticky bottom-3[^"]*"[\s\S]*role="region" aria-label="Bulk action"/); assert.match(source, /className=\{primary\} disabled=\{busy\} onClick=\{\(\) => void act\.go\(\)\}>\{act\.label\}[\s\S]*className=\{secondary\}[\s\S]*?>Clear</);
});

test("Complete review and finish state use summary cards and restrained success styling", () => {
  const summary = html(workflow.SupplierCompleteSummary, { overview, reviewHref: "/f" });
  for (const text of ["Prices updated", "Unchanged prices confirmed", "Items not listed by Supplier (excluded)", "Needs attention", "Ready"]) assert.ok(summary.includes(text), text);
  assert.equal((summary.match(/min-h-\[5\.5rem\]/g) ?? []).length, 6); assert.match(summary, /border-amber-200 bg-amber-50[^>]*role="status"|role="status"[^>]*>|bg-amber-50 p-3/); assert.match(summary, /Review items/); assert.doesNotMatch(summary, /technical|pricing_version/i);
  const blocked = html(controls.SupplierCompletionControls, { batchId: "r", scope: "complete", status: "review", approver: true, reviewHref: "/f" });
  assert.match(blocked, /<button[^>]*disabled=""[^>]*>Complete Brand Review<\/button>/); assert.match(blocked, /bg-emerald-900/); assert.match(blocked, /Complete Review<\/h3>/);
  const finish = html(workflow.SupplierFinishScreen, { brandName: "LAS MOBILI", title: "February 2026", baselineDate: "2026-02-01", overview: { ...overview, families: overview.families.map((item, index) => ({ ...item, excluded: index === 1 ? 1 : 0 })) }, priceUpdatesHref: "/products/price-updates", summaryHref: "/s" });
  assert.match(finish, /✓ Review completed\. Brand price baseline activated\./); assert.match(finish, /3 Product families checked/); assert.match(finish, /1 Family still needs separate price verification/); assert.match(finish, /Baseline date:/);
  assert.match(finish, /<a[^>]*bg-emerald-900[^>]*>Back to Price Updates<\/a>|bg-emerald-900[^"]*text-white[^>]*>Back to Price Updates/); assert.match(finish, />View review summary</);
});

test("Advanced settings accordion stays collapsed; wizard keeps its markup and JSON stays hidden; price health badges unchanged", () => {
  const advanced = html(controls.SupplierAdvancedImportSettings, { brandId: "b", brandName: "LAS", basis: "list", approver: true, templates: [] });
  assert.match(advanced, /<details id="advanced"(?![^>]*open)[^>]*class="[^"]*group[^"]*"/); assert.match(advanced, /Advanced import settings/); assert.match(advanced, /Import profile, vocabulary and technical mapping tools\./); assert.match(advanced, /▸/);
  const start = html(wizard.SupplierImportFormatWizard, { brandName: "LAS MOBILI", brandId: "b", approver: true, doneHref: "/done" });
  for (const text of ["Upload sample", "Map columns", "Price settings", "Test import", "step 1 of 4", 'type="file"']) assert.ok(start.includes(text), text);
  assert.match(start, /aria-current="step"[^>]*>(<span[^>]*>.<\/span>)?Upload sample/); assert.doesNotMatch(start, /<textarea|JSON|full_code_column|<pre/);
  assert.match(start, /rounded-lg border border-zinc-200 bg-white shadow-sm/);
  assert.equal(friendlyPriceHealth({ key: "checked", tone: "ok", detail: "" }, { title: "LAS MOBILI — February 2026" }).label, "✓ Price current");
  assert.equal(friendlyPriceHealth({ key: "needs_check", tone: "warning", detail: "" }).label, "⚠ Needs price check");
  assert.equal(friendlyPriceHealth({ key: "no_price_list_date", tone: "neutral", detail: "" }).label, "No current price list");
});

test("page header and wiring keep the route and behavior while using shared ProjectWorkflow patterns", async () => {
  const page = await read("../../app/products/price-updates/supplier-sources/page.tsx");
  assert.match(page, /← Price Updates/); assert.doesNotMatch(page, />Price-check monitoring</); assert.match(page, /Open Brand/); assert.match(page, /continueHref=\{href\(\{ view: "complete" \}\)\}/);
  assert.match(page, /view: "advanced"/); assert.match(page, /<SupplierTabs /); assert.doesNotMatch(page, /from\("quotation|\.rpc\(/);
});
