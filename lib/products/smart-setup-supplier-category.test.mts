import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { projectDraftPricing, type SmartSetupPriceCell } from "./smart-setup-supplier-targets.js";
import { runSmartSetupSupplierCheck } from "./smart-setup-supplier-check.js";
import { checkFingerprint } from "./smart-setup-supplier-verification.js";
import type { ProductTemplateDraft } from "./product-template-draft.js";
import type { DimensionRule, SourceIdentity } from "./supplier-price-contracts.js";

// The LAS case: one model code with nine supplier categories (A-I), while the draft prices only some of them. Every source identity that maps to no
// draft column used to list all candidates and make the genuinely matching ones "ambiguous". The matcher itself (exact label, rules) is unchanged.
type Tables = Record<string, Array<Record<string, unknown>>>;
const fake = (tables: Tables) => ({ from: (t: string) => { let list = [...(tables[t] ?? [])]; const api: Record<string, unknown> = { select: () => api, order: () => api, range: () => api, neq: () => api, gt: () => api, returns: () => api, eq: (k: string, v: unknown) => { list = list.filter((r) => r[k] === v); return api; }, in: (k: string, v: unknown[]) => { list = list.filter((r) => v.includes(r[k])); return api; }, then: (resolve: (x: unknown) => unknown) => resolve({ data: list, error: null }) }; return api; }, rpc: async () => { throw Error("write attempted"); } }) as unknown as SupabaseClient;
const version = { id: "v1", brand_id: "b1", definition_id: "d1", status: "imported", effective_from: null, created_at: "2026-10-16", currency: "EUR", basis: "list", title: "LAS Chairs" };
const identity = (code: string, dimension: string, price: number | null, over: Partial<SourceIdentity> = {}): SourceIdentity => ({ key: `${code}|${dimension}|${over.key ?? ""}`, code, price_field: "unit_price", dimension, finishes: [], price, currency: "EUR", row_keys: ["r"], issues: [], evidence: [{ row_number: 12, sheet: "Chairs", full_supplier_code: `${code}475` }], ...over });
const tables = (identities: SourceIdentity[], rules: DimensionRule[] = []): Tables => ({ brands: [{ id: "b1" }], supplier_source_definitions: [{ id: "d1", brand_id: "b1", is_active: true }], supplier_source_versions: [version],
  supplier_source_identities: identities.map((data) => ({ source_id: "v1", key: data.key, code: data.code, data })), supplier_dimension_vocabulary: rules.map((r) => ({ ...r, is_active: true })), supplier_price_bindings: [] });
const LAS: Array<[string, number]> = [["Category A", 951], ["Category B", 992], ["Category C", 1029], ["Category D", 1075], ["Category E", 1104], ["Category F", 1136], ["Category G", 1187], ["Category H", 1703], ["Category I", 1299]];
const lasSource = LAS.map(([dimension, price]) => identity("142970", dimension, price));
const priced = (id: string, code: string | null, extra: Record<string, unknown> = {}) => ({ id, label: id, displayName: null, dimensions: null, currency: "EUR" as const, price: null, specification: null, supplierCodes: code ? [code] : [], referenceCodes: [], ...extra });
const draft = (pricing: Record<string, unknown>, optionGroups: unknown[] = []): ProductTemplateDraft => ({ version: 1, template: { supplierCodes: [], referenceCodes: [], templateName: "T", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null }, defaultCurrency: "EUR", pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [], ...pricing }, optionGroups, materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [] }) as unknown as ProductTemplateDraft;
const matrix = (prices: Record<string, number>, labels: Record<string, string> = { ca: "Category A", cb: "Category B", cc: "Category C" }, code = "142 970") => draft({ priceMatrices: [{ id: "pm", label: null, columns: Object.entries(labels).map(([id, label]) => ({ id, label })), rows: [{ ...priced("m1", code), prices }] }] });
async function check(t: Tables, cells: SmartSetupPriceCell[]) {
  const out = await runSmartSetupSupplierCheck({ requireReviewer: async () => ({}), getClient: async () => fake(t) }, { brandId: "b1", definitionId: "d1", sourceVersionId: "v1", cells });
  return Object.fromEntries(out.results.map((r) => [r.locator.split(":").pop()!, r]));
}

test("exact category A, B and C with matching prices are MATCHED even though the source also has categories D-I", async () => {
  const r = await check(tables(lasSource), projectDraftPricing(matrix({ ca: 951, cb: 992, cc: 1029 })).cells);
  assert.deepEqual([r.ca.status, r.cb.status, r.cc.status], ["MATCHED", "MATCHED", "MATCHED"]);
  assert.deepEqual([r.ca.referencePrice, r.cb.referencePrice, r.cc.referencePrice], [951, 992, 1029]);
  assert.deepEqual([r.ca.evidence?.sheet, r.ca.evidence?.rowNumber], ["Chairs", 12]);                          // supplier price and source evidence are shown
});
test("a different price in the exact category is a MISMATCH against that category's price", async () => {
  const r = await check(tables(lasSource), projectDraftPricing(matrix({ ca: 999, cb: 992, cc: 1029 })).cells);
  assert.deepEqual([r.ca.status, r.ca.importedPrice, r.ca.referencePrice], ["MISMATCH", 999, 951]);
  assert.equal(r.cb.status, "MATCHED");
});
test("another category's price is never accepted: draft A = 992 (B's price) is a MISMATCH with A's price", async () => {
  const r = await check(tables(lasSource), projectDraftPricing(matrix({ ca: 992, cb: 992, cc: 1029 })).cells);
  assert.deepEqual([r.ca.status, r.ca.referencePrice, r.cb.status], ["MISMATCH", 951, "MATCHED"]);
});
test("a draft category the supplier does not have needs review (not a guessed match)", async () => {
  const r = await check(tables(lasSource.filter((i) => i.dimension !== "Category C")), projectDraftPricing(matrix({ ca: 951, cb: 992, cc: 1029 })).cells);
  assert.deepEqual([r.ca.status, r.cb.status, r.cc.status, r.cc.reason, r.cc.referencePrice], ["MATCHED", "MATCHED", "NEEDS_REVIEW", "needs_dimension_mapping", null]);
});
test("labels that are not provably the same dimension stay NEEDS_REVIEW with the real reason; a confirmed brand rule resolves them", async () => {
  const cells = projectDraftPricing(matrix({ ca: 951, cb: 992 }, { ca: "A", cb: "B" })).cells;
  const unmapped = await check(tables(lasSource), cells);
  assert.ok([unmapped.ca, unmapped.cb].every((x) => x.status === "NEEDS_REVIEW" && x.reason === "needs_dimension_mapping" && x.referencePrice === null));
  const rules: DimensionRule[] = [{ id: "r1", brand_id: "b1", raw_labels: ["Category A"], finish_codes: [], dimension_code: "a" }, { id: "r2", brand_id: "b1", raw_labels: ["Category B"], finish_codes: [], dimension_code: "b" }];
  const mapped = await check(tables(lasSource, rules), cells);
  assert.deepEqual([mapped.ca.status, mapped.cb.status], ["MATCHED", "MATCHED"]);
});
test("missing category context in the supplier identity needs review", async () => {
  const r = await check(tables([identity("142970", "", 951)]), projectDraftPricing(matrix({ ca: 951 }, { ca: "Category A" })).cells);
  assert.deepEqual([r.ca.status, r.ca.referencePrice], ["NEEDS_REVIEW", null]);
});
test("conflicting supplier identities in the same exact category need review", async () => {
  const r = await check(tables([identity("142970", "Category A", 951, { key: "x" }), identity("142970", "Category A", 960, { key: "y" })]), projectDraftPricing(matrix({ ca: 951 }, { ca: "Category A" })).cells);
  assert.deepEqual([r.ca.status, r.ca.reason, r.ca.referencePrice], ["NEEDS_REVIEW", "ambiguous_source_contexts", null]);
});
test("no prefix, near-code or price-only matching; the price field and currency are still checked", async () => {
  const cells = projectDraftPricing(matrix({ ca: 951 }, { ca: "Category A" })).cells;
  assert.equal((await check(tables([identity("1429700", "Category A", 951)]), cells)).ca.status, "NOT_FOUND");                    // longer code with the same price
  assert.equal((await check(tables([identity("142970", "Category A", 951, { price_field: "default_price" })]), cells)).ca.status, "NOT_FOUND");
  assert.equal((await check(tables([identity("142970", "Category A", 951, { currency: "USD" })]), cells)).ca.reason, "currency_mismatch");
});
test("dimension-less products are unchanged: Base/Model matches and mismatches by code and price", async () => {
  const cells = projectDraftPricing(draft({ baseModelRows: [priced("a", "BM1", { price: 100 }), priced("b", "BM2", { price: 130 })] })).cells;
  const r = await check(tables([identity("BM1", "", 100), identity("BM2", "", 120)]), cells);
  assert.deepEqual([r["a"].status, r["b"].status, r["b"].referencePrice], ["MATCHED", "MISMATCH", 120]);
});
test("a repeated option code with different supplier contexts is never resolved by taking the first", async () => {
  const cells = projectDraftPricing(draft({}, [{ id: "og", label: null, selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [priced("i1", "OPT", { price: 10 })] }])).cells;
  const r = await check(tables([identity("OPT", "Model X", 10), identity("OPT", "Model Y", 99)]), cells);
  assert.deepEqual([r["i1"].status, r["i1"].referencePrice], ["NEEDS_REVIEW", null]);
});
test("editing a draft price changes the check fingerprint, so an earlier result becomes stale", () => {
  const a = checkFingerprint({ draft: matrix({ ca: 951 }, { ca: "Category A" }), routingPlan: null, brandId: "b1", definitionId: "d1", versionId: "v1" });
  const b = checkFingerprint({ draft: matrix({ ca: 952 }, { ca: "Category A" }), routingPlan: null, brandId: "b1", definitionId: "d1", versionId: "v1" });
  assert.notEqual(a, b);
});
test("the matcher and supplier identities are untouched by this fix", () => {
  const changed = readFileSync("lib/products/smart-setup-supplier-check.ts", "utf8");
  assert.doesNotMatch(changed, /\.startsWith\(|levenshtein|\.indexOf\(|substring\(/);                              // no prefix or fuzzy code logic added
  assert.match(changed, /import \{ comparisonCode, matchSupplierPrices \} from "\.\/supplier-price-matching"/);   // the existing matcher decides
  assert.match(changed, /needs_dimension_mapping"\) \{ unmapped\.push/);
});
