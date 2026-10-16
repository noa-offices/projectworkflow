import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductTemplateDraft } from "@/lib/products/product-template-draft";
import type { SmartSetupSupplierCheckOutput, SmartSetupSupplierCheckResult } from "@/lib/products/smart-setup-supplier-check";
import { listSmartSetupSupplierSources } from "@/lib/products/smart-setup-supplier-sources";
import { projectDraftPricing } from "@/lib/products/smart-setup-supplier-targets";
import { buildSmartSetupCheckRequest, checkFingerprint } from "@/lib/products/smart-setup-supplier-verification";

// The panel imports server actions (auth, cookies). Panel rendering is presentation-only, so the actions are stubbed.
mock.module("@/app/products/smart-setup-supplier-check-actions", { namedExports: { checkSmartSetupSupplierPrices: async () => { throw Error("not called in static render"); }, listSmartSetupSupplierSourcesAction: async () => ({ status: "unauthorized" }) } });
const { SupplierVerificationPanel } = await import("./smart-setup-supplier-verification");

const priced = (id: string, code: string | null, price: number | null, extra: Record<string, unknown> = {}) => ({ id, label: id, displayName: null, dimensions: null, currency: "EUR" as const, price, specification: null, supplierCodes: code ? [code] : [], referenceCodes: [], ...extra });
const draft = (pricing: Record<string, unknown> = {}, optionGroups: unknown[] = []): ProductTemplateDraft => ({ version: 1, template: { supplierCodes: [], referenceCodes: [], templateName: "T", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null }, defaultCurrency: "EUR",
  pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [], ...pricing }, optionGroups, materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [] }) as unknown as ProductTemplateDraft;
const plan = { routes: [{ key: "base_model:rows", destination: "base_model" }] };
const fp = (d: ProductTemplateDraft, over: Record<string, unknown> = {}) => checkFingerprint({ draft: d, routingPlan: plan, brandId: "b1", definitionId: "d1", versionId: "v1", ...over });

// ---- staleness fingerprint ----
const matrix = (extra: Record<string, unknown> = {}) => ({ priceMatrices: [{ id: "pm", label: null, columns: [{ id: "ca", label: "Cat A" }], rows: [{ ...priced("r1", "M1", 0), prices: { ca: 10 } }] }], ...extra });
test("the fingerprint is stable for an identical draft and changes for every result-relevant edit", () => {
  const base = draft({ baseModelRows: [priced("a", "A1", 100)] });
  assert.equal(fp(base), fp(structuredClone(base)));
  const changed = (d: ProductTemplateDraft, over: Record<string, unknown> = {}) => assert.notEqual(fp(d, over), fp(base));
  changed(draft({ baseModelRows: [priced("a", "A1", 101)] }));                               // price
  changed(draft({ baseModelRows: [priced("a", "A1", 100, { currency: "USD" })] }));          // currency
  changed(draft({ baseModelRows: [priced("a", "A2", 100)] }));                               // supplier code
  changed(draft({ baseModelRows: [priced("a", "A1", 100, { label: "Other model" })] }));     // model
  changed(draft({ baseModelRows: [priced("a", "A1", 100, { dimensions: { width: 1, depth: null, height: null, diameter: null, unit: "cm", rawText: null } })] })); // size
  changed(draft({ baseModelRows: [priced("a", "A1", 100), priced("b", "B1", 5)] }));         // Add More JSON merge
  changed(base, { brandId: "b2" }); changed(base, { definitionId: "d2" }); changed(base, { versionId: "v2" });
  assert.notEqual(checkFingerprint({ draft: base, routingPlan: { routes: [] }, brandId: "b1", definitionId: "d1", versionId: "v1" }), fp(base)); // routing destination
  const m = draft(matrix());
  assert.notEqual(fp(draft(matrix({ priceMatrices: [{ id: "pm", label: null, columns: [{ id: "cb", label: "Cat B" }], rows: [{ ...priced("r1", "M1", 0), prices: { cb: 10 } }] }] }))), fp(m)); // category column
  const mod = (mode: string) => draft({ modularGroups: [{ id: "g", label: null, defaultDimensions: null, defaultSpecification: null, pricingMode: mode, directRows: [priced("d", "D1", 1)], matrix: { id: "x", label: null, columns: [], rows: [] } }] });
  assert.notEqual(fp(mod("direct")), fp(mod("matrix")));                                      // modular mode
  const ws = (additional: number | null) => draft({ workstationRows: [{ ...priced("w", "W1", 10), additionalPrice: additional, layoutType: null }] });
  assert.notEqual(fp(ws(5)), fp(ws(null)));                                                   // workstation price field
});

// ---- request building ----
test("the request is exactly the draft projection; over 500 cells is refused, never truncated", () => {
  const d = draft({ baseModelRows: [priced("a", "A1", 100), priced("b", null, 5)] });
  const request = buildSmartSetupCheckRequest(d);
  assert.ok(request.ok); if (!request.ok) return;
  assert.deepEqual(request.cells, projectDraftPricing(d).cells); assert.equal(request.unsupported.length, 1);
  const big = buildSmartSetupCheckRequest(draft({ baseModelRows: Array.from({ length: 501 }, (_, i) => priced(`r${i}`, `C${i}`, i)) }));
  assert.deepEqual(big.ok, false); assert.match(big.ok ? "" : big.message, /501.*500/); assert.ok(!("cells" in big));
  assert.equal(buildSmartSetupCheckRequest(draft()).ok, false);
});

// ---- source list ----
type Tables = Record<string, Array<Record<string, unknown>>>;
function fakeClient(tables: Tables) {
  const reads: string[] = [];
  const builder = (table: string) => { reads.push(table); let rows = [...(tables[table] ?? [])]; const api: Record<string, unknown> = { select: () => api, order: () => api, range: () => api, eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return api; }, then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }) }; return api; };
  return { client: { from: builder } as unknown as SupabaseClient, reads };
}
const ver = (over: Record<string, unknown>) => ({ id: "v1", brand_id: "b1", definition_id: "d1", status: "imported", effective_from: null, received_at: null, created_at: "2024-01-01", currency: "EUR", basis: "list", title: "List 2024", ...over });
const tables = (versions: Array<Record<string, unknown>>): Tables => ({ brands: [{ id: "b1" }, { id: "b2" }], supplier_source_definitions: [{ id: "d1", brand_id: "b1", name: "Furniture", is_active: true }, { id: "d2", brand_id: "b2", name: "Other brand", is_active: true }, { id: "d3", brand_id: "b1", name: "Inactive", is_active: false }], supplier_source_versions: versions });
const list = (t: Tables, role = "system_owner", status = "active", brand: unknown = "b1") => { const f = fakeClient(t); return listSmartSetupSupplierSources({ getProfile: async () => ({ role, account_status: status }), getClient: async () => f.client }, brand).then((r) => ({ r, reads: f.reads })); };

test("an unauthorized user gets no source data and nothing is read", async () => {
  const { r, reads } = await list(tables([ver({})]), "sales_designer");
  assert.deepEqual(r, { status: "unauthorized" }); assert.deepEqual(reads, []);
  assert.equal((await list(tables([ver({})]), "system_owner", "pending")).r.status, "unauthorized");
});
test("only the Brand's active definitions with their single applicable version are offered", async () => {
  const { r } = await list(tables([ver({}), ver({ id: "v-old", created_at: "2023-01-01" }), ver({ id: "v-future", effective_from: "2999-01-01" }), ver({ id: "v-arch", status: "archived" }), ver({ id: "v-b2", brand_id: "b2", definition_id: "d2" }), ver({ id: "v-inactive", definition_id: "d3" })]));
  assert.equal(r.status, "ok"); if (r.status !== "ok") return;
  assert.deepEqual(r.sources.map((s) => [s.definitionId, s.versionId, s.currency, s.basis]), [["d1", "v1", "EUR", "list"]]);
});
test("no applicable version, unknown basis, or unknown brand means no usable source", async () => {
  for (const versions of [[ver({ effective_from: "2999-01-01" })], [ver({ status: "archived" })], [ver({ basis: "unknown" })], []]) assert.deepEqual((await list(tables(versions))).r, { status: "ok", sources: [] });
  assert.deepEqual((await list(tables([ver({})]), "system_owner", "active", "nope")).r, { status: "ok", sources: [] });
});

// ---- panel rendering ----
const result = (over: Partial<SmartSetupSupplierCheckResult>): SmartSetupSupplierCheckResult => ({ locator: "base_model:legacy:m", role: "main_product", code: "A1", priceField: "unit_price", dimension: "", status: "MATCHED", reason: "same_price", importedPrice: 100, importedCurrency: "EUR", referencePrice: 100, referenceCurrency: "EUR", source: { versionId: "v1", definitionId: "d1", title: "List 2024", currency: "EUR", basis: "list" }, evidence: { identityKey: "k", sheet: "S1", rowNumber: 7, sourceRowCount: null }, ...over });
const option = { definitionId: "d1", name: "Furniture", versionId: "v1", versionTitle: "List 2024", effectiveFrom: "2024-02-01", receivedAt: null, currency: "EUR", basis: "list" };
const output = (results: SmartSetupSupplierCheckResult[]): SmartSetupSupplierCheckOutput => ({ source: results[0].source, results });
const panel = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(SupplierVerificationPanel, { brandId: "b1", sources: { state: "ready", options: [option] }, definitionId: "d1", onSelect() {}, selected: option, running: false, error: null, stale: false, fresh: null, showAll: false, onShowAll() {}, limit: 50, onMore() {}, onRun() {}, ...over } as never));

test("panel states: no brand, loading, unauthorized, no applicable list, selection required", () => {
  assert.match(panel({ brandId: "", sources: { state: "loading" } }), /Select a brand/);
  assert.match(panel({ sources: { state: "loading" } }), /Loading supplier price lists/);
  const denied = panel({ sources: { state: "unauthorized" } }); assert.match(denied, /not available for your account/); assert.doesNotMatch(denied, /Furniture/);
  assert.match(panel({ sources: { state: "ready", options: [] } }), /No applicable supplier price list/);
  const html = panel({ definitionId: "", selected: null });
  assert.match(html, /Select a supplier price list/); assert.match(html, /Furniture — List 2024, effective 2024-02-01 · EUR · list price/); assert.match(html, /<button[^>]*disabled=""[^>]*>Check Supplier Prices/);
  assert.doesNotMatch(panel(), /<button[^>]*disabled=""[^>]*>Check Supplier Prices/);
});

test("results: backend counts, discrepancy-first rows, ambiguous rows show no supplier price, source identity shown", () => {
  const results = [
    result({ locator: "l1", code: "OK1" }),
    result({ locator: "l2", code: "MM1", status: "MISMATCH", reason: "price_differs", importedPrice: 120, referencePrice: 110 }),
    result({ locator: "l3", code: "AMB1", status: "NEEDS_REVIEW", reason: "ambiguous_source_contexts", referencePrice: null, referenceCurrency: null, evidence: null, importedPrice: 10 }),
    result({ locator: "l4", code: "NF1", status: "NOT_FOUND", reason: "no_source_candidate", referencePrice: null, referenceCurrency: null, evidence: null }),
  ];
  const html = panel({ fresh: { fingerprint: "x", output: output(results), cells: [], unsupported: [] } });
  for (const text of ["MATCHED 1", "MISMATCH 1", "NOT FOUND 1", "NEEDS REVIEW 1", "List 2024", "EUR", "list price"]) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf("MM1") < html.indexOf("AMB1"), "mismatch before needs review");
  assert.ok(!html.includes("OK1") && !html.includes("NF1"), "matched and not found are hidden by default");
  assert.match(html, /EUR 120/); assert.match(html, /EUR 110/);                      // imported and supplier prices remain separate columns
  const amb = html.slice(html.indexOf("AMB1")); assert.match(amb.slice(0, amb.indexOf("</tr>")), /<td>EUR 10<\/td><td>—<\/td>/);
  assert.match(html, /several prices for this code/); assert.match(html, /informational; you can still apply/);
  const all = panel({ showAll: true, fresh: { fingerprint: "x", output: output(results), cells: [], unsupported: [] } }); assert.ok(all.includes("OK1") && all.includes("NF1"));
});

test("a stale result is not shown as current", () => {
  const html = panel({ stale: true, fresh: null });
  assert.match(html, /no longer shown/); assert.doesNotMatch(html, /MATCHED \d/); assert.match(html, /Result is out of date/);
});

test("large results render a bounded page", () => {
  const results = Array.from({ length: 120 }, (_, i) => result({ locator: `l${i}`, code: `C${i}`, status: "MISMATCH", reason: "price_differs" }));
  const html = panel({ fresh: { fingerprint: "x", output: output(results), cells: [], unsupported: [] } });
  assert.equal(html.match(/<tr /g)?.length, 51); // header + 50 rows assert.match(html, /70 remaining/);
});

// ---- integration wiring ----
test("Smart Setup wiring: verification sits before Apply, brand is bridged, Apply and writes are untouched", () => {
  const importer = readFileSync("components/products/smart-product-json-import.tsx", "utf8");
  const form = readFileSync("components/products/product-template-form.tsx", "utf8");
  const ui = readFileSync("components/products/smart-setup-supplier-verification.tsx", "utf8") + readFileSync("lib/products/smart-setup-supplier-verification.ts", "utf8");
  assert.equal((form.match(/<SmartProductJsonImport selectedBrandId=\{selectedBrandId\}/g) ?? []).length, 3);
  assert.ok(importer.indexOf("<SmartSetupSupplierVerification key={brandId}") < importer.indexOf("onClick={confirmApply}") || importer.indexOf("<SmartSetupSupplierVerification") < importer.indexOf("Continue"));
  assert.match(importer, /brandId=\{brandId\}/);
  assert.doesNotMatch(importer.slice(importer.indexOf("const requestApply"), importer.indexOf("const routingValidation")), /SupplierVerification|checkSmartSetupSupplierPrices/); // Apply path does not consult the check
  assert.doesNotMatch(ui, /supplierApplyReviewedPrice|supplierWrite|\.insert\(|\.update\(|\.rpc\(|matchSupplierPrices/);
});
