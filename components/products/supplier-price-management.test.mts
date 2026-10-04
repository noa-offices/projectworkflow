import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { friendlyPriceHealth, latestBrandPriceListUpdate, productTemplatePriceCheckState } from "../../lib/product-price-check.js";
import { assertSupplierProfile } from "../../lib/products/supplier-price-contracts.js";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
async function load<T>(path: string, dependencies: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(path, import.meta.url);
  const output = ts.transpileModule(await read(path), { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => Object.hasOwn(dependencies, name) ? dependencies[name] : createRequire(url)(name.startsWith("@/") ? fileURLToPath(new URL(`../../${name.slice(2)}`, import.meta.url)) : name), compiled, compiled.exports);
  return compiled.exports as T;
}
const link = { default: ({ children, ...props }: { href: string; children: unknown }) => React.createElement("a", props, children as never) };
const common = {
  "next/link": link, "next/navigation": { useRouter() { return { refresh() {}, push() {} }; } },
  "@/lib/supabase/client": { createClient() { assert.fail("Rendering must not create a database client."); } }, "@/app/products/price-updates/supplier-sources/actions": {},
};
type Component = (props: Record<string, unknown>) => React.ReactElement | null;
const html = (component: Component, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(component as never, props as never));
const controls = await load<Record<"SupplierAdvancedImportSettings" | "SupplierArchiveButton", Component>>("./supplier-price-workspace-controls.tsx", common);
const workflow = await load<Record<"SupplierTabs" | "SupplierCurrentPriceList" | "SupplierHistoryTable", Component>>("./supplier-price-workflow.tsx", { ...common, "@/components/products/supplier-price-workspace-controls": controls });
const wizard = await load<{ SupplierImportFormatWizard: Component; buildImportProfile: (choices: Record<string, unknown>) => Record<string, unknown>; testImportProfile: (rows: unknown[], profile: unknown) => { items: number; valid: number; attention: number; problems: Array<[string, number]> } }>("./supplier-import-format-wizard.tsx", common);
const pageSource = await read("../../app/products/price-updates/supplier-sources/page.tsx");
const workflowSource = await read("./supplier-price-workflow.tsx");
const controlsSource = await read("./supplier-price-workspace-controls.tsx");
const selectorSource = await read("../quotations/product-library-selector.tsx");
const actionsSource = await read("../../app/products/price-updates/supplier-sources/actions.ts");

const hrefs = { current: "/c", import: "/i", history: "/h" };
const row = (id: string, title: string, status: string, extra: Record<string, unknown> = {}) => ({ id, title, date: "2026-02-01", status, coverage: "Complete Brand", baseline: "—", viewHref: `/v/${id}`, ...extra });

test("Current price list / Import new / History are the three areas", () => {
  const tabs = html(workflow.SupplierTabs, { tab: "history", hrefs });
  assert.ok(tabs.indexOf("Current price list") < tabs.indexOf("Import new") && tabs.indexOf("Import new") < tabs.indexOf("History"));
  assert.match(tabs, /aria-current="page"[^>]*>History/); assert.doesNotMatch(tabs, /aria-current="page"[^>]*>Current/);
  const current = html(workflow.SupplierCurrentPriceList, { brandName: "LAS MOBILI", current: { title: "February 2026", currency: "EUR", basis: "list", baselineDate: "2026-02-01", families: 6, href: "/review" }, inProgress: null, importHref: "/i" });
  for (const text of ["Current Price List", "February 2026", "EUR · List", "✓ Brand baseline active", "6 Product families reviewed", "Baseline: 2026-02-01", "View review"]) assert.ok(current.includes(text), text);
  const none = html(workflow.SupplierCurrentPriceList, { brandName: "LAS MOBILI", current: null, inProgress: { title: "Review", href: "/continue" }, importHref: "/i" });
  assert.match(none, /No completed Brand price list yet\./); assert.match(none, /href="\/i"[^>]*>Import new price list/); assert.match(none, /Continue review/); assert.doesNotMatch(none, /Brand baseline active/);
  assert.match(pageSource, /const tab: PriceListTab = /); assert.match(pageSource, /<SupplierTabs /); assert.match(pageSource, /tab === "import"/); assert.match(pageSource, /tab === "history"/);
});

test("History hides archived by default, offers View / Download / Archive, and never Delete", () => {
  const rows = [row("s1", "February 2026", "current", { baseline: "Active baseline", downloadUrl: "https://example.test/f" }), row("s0", "November 2025", "current", { baseline: "Replaced" }), row("sa", "Old list", "archived"), row("sf", "Broken import", "unfinished")];
  const props = { rows, showArchived: false, archivedCount: 1, toggleHref: "/toggle", pagerHrefs: { previous: "/p", next: "/n" }, canArchive: true, reviews: [], reviewHref: () => "/r" };
  const closed = html(workflow.SupplierHistoryTable, props);
  for (const text of ["February 2026", "November 2025", "Broken import", "Unfinished import", "Active baseline", "Replaced", "Complete Brand", "Show archived (1)"]) assert.ok(closed.includes(text), text);
  assert.doesNotMatch(closed, /Old list/);
  assert.match(closed, /href="\/v\/s1"[^>]*>View/); assert.match(closed, /href="https:\/\/example\.test\/f"[^>]*>Download/); assert.match(closed, />Archive</);
  assert.doesNotMatch(closed, /Delete|Rename|batch|commercial identit/i); assert.doesNotMatch(closed, />s1<|>sf<|data-id/);
  const open = html(workflow.SupplierHistoryTable, { ...props, showArchived: true });
  assert.match(open, /Old list/); assert.match(open, /Hide archived/); assert.equal((open.match(/>Archive</g) ?? []).length, 3); // archived rows have no Archive action
  assert.doesNotMatch(html(workflow.SupplierHistoryTable, { ...props, canArchive: false }), />Archive</);
  // Hard delete is not provided: no delete operation exists for sources and used lists are evidence.
  assert.doesNotMatch(workflowSource + controlsSource + pageSource, /deleteSupplier|delete_source|Delete price list/);
  assert.match(actionsSource, /export async function archiveSupplierSource\(sourceId: string\) \{\r?\n  const \{ client \} = await reviewer\(\);/);
  assert.match(html(controls.SupplierArchiveButton, { sourceId: "s1", title: "February 2026" }), /aria-label="Archive price list February 2026"/);
});

const rows = [
  { unit_key: "1", row_number: 2, sheet: "S", values: { CODICE_ARTICOLO: "103801160", NOME_FILE: "103801", PREZZO_UNITARIO: 81, CATEGORIA_TESSUTO: "melamine", NOTE: "x" } },
  { unit_key: "2", row_number: 3, sheet: "S", values: { CODICE_ARTICOLO: "103802160", NOME_FILE: "103802", PREZZO_UNITARIO: 99, CATEGORIA_TESSUTO: "melamine", NOTE: "x" } },
  { unit_key: "3", row_number: 4, sheet: "S", values: { CODICE_ARTICOLO: "103803160", NOME_FILE: "103803", PREZZO_UNITARIO: "n/a", CATEGORIA_TESSUTO: "melamine", NOTE: "x" } },
  { unit_key: "4", row_number: 5, sheet: "S", values: { CODICE_ARTICOLO: "", NOME_FILE: "", PREZZO_UNITARIO: 5, CATEGORIA_TESSUTO: "melamine", NOTE: "x" } },
];
const choices = { fullCode: "CODICE_ARTICOLO", articleCode: "NOME_FILE", price: "PREZZO_UNITARIO", category: "CATEGORIA_TESSUTO", description: "", currency: "EUR", basis: "list", structure: "article_finish", articleLength: 6, finishLength: 3 };

test("Import-format wizard maps columns with dropdowns and generates the existing profile shape", () => {
  const profile = wizard.buildImportProfile(choices) as Record<string, unknown>;
  assertSupplierProfile(profile); // the existing validator accepts it unchanged
  assert.deepEqual(profile, { strategy: "article_plus_finish", full_code_column: "CODICE_ARTICOLO", price_columns: [{ column: "PREZZO_UNITARIO", price_field: "unit_price" }], currency: "EUR", basis: "list", article_code_column: "NOME_FILE", article_length: 6, finish_length: 3, validated_article_fallback: true, category_column: "CATEGORIA_TESSUTO" });
  assert.deepEqual(wizard.buildImportProfile({ ...choices, structure: "simple", category: "CATEGORIA_TESSUTO", currency: "AED", basis: "net", description: "NOTE" }), { strategy: "exact", full_code_column: "CODICE_ARTICOLO", price_columns: [{ column: "PREZZO_UNITARIO", price_field: "unit_price" }], currency: "AED", basis: "net", description_column: "NOTE" });
  assert.equal((wizard.buildImportProfile({ ...choices, structure: "matrix" }) as { category_column?: string }).category_column, "CATEGORIA_TESSUTO");
  assert.throws(() => wizard.buildImportProfile({ ...choices, price: "" }), /Invalid profile price columns/);
  assert.throws(() => wizard.buildImportProfile({ ...choices, articleLength: 0 }), /Article and finish lengths/);
});

test("Test import reports friendly counts from the real normalisation", () => {
  const result = wizard.testImportProfile(rows, wizard.buildImportProfile(choices));
  assert.deepEqual({ items: result.items, valid: result.valid, attention: result.attention }, { items: 4, valid: 2, attention: 2 });
  assert.ok(result.problems.length > 0 && result.problems.every(([label]) => !/_/.test(label)));
  assert.ok(result.problems.some(([label]) => /Missing Supplier code/.test(label)));
});

test("Wizard starts from a sample upload, shows no JSON, and is approver-only; saved formats become the auto-selected default", () => {
  const start = html(wizard.SupplierImportFormatWizard, { brandName: "LAS MOBILI", brandId: "b", approver: true, doneHref: "/done" });
  assert.match(start, /Set up import profile/); assert.match(start, /type="file"/); assert.match(start, /step 1 of 4/); assert.doesNotMatch(start, /<textarea|JSON|full_code_column|<pre/);
  const reviewer = html(wizard.SupplierImportFormatWizard, { brandName: "LAS MOBILI", brandId: "b", approver: false, doneHref: "/done" });
  assert.match(reviewer, /An approver sets up import profiles/); assert.doesNotMatch(reviewer, /type="file"/);
  assert.match(pageSource, /text\(params\.setup\) === "1" \? <SupplierImportFormatWizard/); // setup is reached from the Import card's "Set up import profile"
  assert.match(pageSource, /setupHref=\{href\(\{ tab: "import", setup: "1" \}\)\}/);
});

test("Advanced settings keep the technical tools and expose generated JSON read-only", () => {
  const profiles = [{ id: "p", title: "LAS standard price list", config: wizard.buildImportProfile(choices) }];
  const advanced = html(controls.SupplierAdvancedImportSettings, { brandId: "b", brandName: "LAS MOBILI", basis: "list", approver: true, templates: [], dimensions: [], profiles });
  assert.match(advanced, /<details id="advanced"(?![^>]*open)/); assert.match(advanced, /Change import profile/); assert.match(advanced, /View generated JSON — LAS standard price list/); assert.match(advanced, /<pre aria-label="Generated JSON for LAS standard price list \(read-only\)"/);
  assert.match(advanced, /Profile JSON/); assert.match(advanced, /Brand dimension vocabulary/); assert.match(advanced, /Stored group ID/); // editing tools stay where they were, approver-only
  assert.equal(html(controls.SupplierAdvancedImportSettings, { brandId: "b", brandName: "LAS MOBILI", basis: "list", approver: false, templates: [], profiles }), "");
});

const baseline = (title: string, effective: string) => ({ title, effective_from: effective, received_at: null, created_at: effective, status: "active", coverage_mode: "complete" });
const checkAt = (checked: string | null, updates: Array<ReturnType<typeof baseline>>) => {
  const latest = latestBrandPriceListUpdate(updates);
  const state = productTemplatePriceCheckState({ formatDate: String, latestBrandPriceListUpdate: latest, now: Date.parse("2026-03-01"), template: { created_at: "2025-01-01", last_price_checked_at: checked, price_check_interval_days: 3650 } });
  return { state, latest };
};

test("Product price health reuses the existing state and speaks plainly", () => {
  const feb = baseline("LAS MOBILI — February 2026", "2026-02-01");
  const current = checkAt("2026-02-10", [feb]);
  assert.deepEqual(friendlyPriceHealth(current.state, current.latest), { key: "current", label: "✓ Price current", tone: "ok", helper: "Checked against LAS MOBILI — February 2026" });
  const behind = checkAt("2026-01-10", [feb]); // checked before the newest baseline (e.g. excluded from the latest list)
  assert.deepEqual(friendlyPriceHealth(behind.state, behind.latest), { key: "needs_check", label: "⚠ Needs price check", tone: "warning", helper: "A newer Supplier price list is available." });
  const none = checkAt(null, []);
  assert.deepEqual(friendlyPriceHealth(none.state, none.latest), { key: "no_price_list", label: "No current price list", tone: "neutral", helper: "This Brand has no active complete Supplier price list." });
  const quotation = friendlyPriceHealth(behind.state, behind.latest, "quotation");
  assert.deepEqual([quotation.label, quotation.helper], ["⚠ Price needs verification", "This Product has not been checked against the latest Supplier price list."]);
  assert.equal(friendlyPriceHealth(current.state, current.latest, "quotation").label, "✓ Price current");
  assert.equal(friendlyPriceHealth(current.state, { title: null }).helper, "Checked against the latest Supplier price list");
  // A partial / draft update never moves the baseline, so health stays "no current price list".
  const partial = checkAt("2026-02-10", [{ ...feb, coverage_mode: "partial" }, { ...feb, status: "draft" }]);
  assert.equal(friendlyPriceHealth(partial.state, partial.latest).key, "no_price_list");
});

test("Product Library and quotation selector show health without blocking selection or touching quotation prices", () => {
  assert.match(selectorSource, /friendlyPriceHealth\(status, template\.latest_brand_price_list_update, "quotation"\)/);
  assert.match(selectorSource, /\{health\.label\}/); assert.match(selectorSource, /\{health\.helper\}/);
  // The warning block only adds guidance; no code path disables adding a Product because of its price-check tone.
  assert.doesNotMatch(selectorSource, /disabled=\{[^}]*priceCheckState\(/); assert.doesNotMatch(selectorSource, /tone === "warning"[^\n]*(return null|disabled)/);
  assert.match(selectorSource, /Please verify source price before finalizing quotation\./);
});

test("no quotation or pricing writes were added to the price list screens", () => {
  for (const source of [workflowSource, pageSource]) assert.doesNotMatch(source, /from\("quotation|\.rpc\(|apply_supplier|write_product_price/);
  assert.match(actionsSource, /export async function saveSupplierProfile\(brandId: string, title: string, config: unknown\) \{\r?\n  const \{ client \} = await approver\(\);/);
});
