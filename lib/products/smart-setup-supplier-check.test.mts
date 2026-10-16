import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { projectDraftPricing, type SmartSetupPriceCell } from "./smart-setup-supplier-targets.js";
import { runSmartSetupSupplierCheck, SMART_SETUP_CHECK_MAX_CELLS } from "./smart-setup-supplier-check.js";
import type { ProductTemplateDraft } from "./product-template-draft.js";
import type { DimensionRule, DurableBinding, SourceIdentity } from "./supplier-price-contracts.js";

type Tables = Record<string, Array<Record<string, unknown>>>;
function fakeClient(tables: Tables) {
  const calls: string[] = [];
  const builder = (table: string) => {
    let rows = [...(tables[table] ?? [])]; calls.push(`read:${table}`);
    const api: Record<string, unknown> = {
      select: () => api, order: () => api, range: () => api, neq: () => api, gt: () => api, returns: () => api,
      eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return api; },
      in: (k: string, v: unknown[]) => { rows = rows.filter((r) => v.includes(r[k])); return api; },
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return api;
  };
  const forbidden = (name: string) => () => { calls.push(`WRITE:${name}`); throw Error(`write attempted: ${name}`); };
  const client = { from: builder, rpc: forbidden("rpc"), storage: { from: forbidden("storage") } } as unknown as SupabaseClient;
  return { client, calls };
}

const today = new Date().toISOString().slice(0, 10);
const version = (over: Record<string, unknown> = {}) => ({ id: "v1", brand_id: "b1", definition_id: "d1", status: "imported", effective_from: null, created_at: "2024-01-01", currency: "EUR", basis: "list", title: "List 2024", ...over });
const identity = (code: string, price: number | null, over: Partial<SourceIdentity> = {}): SourceIdentity => ({ key: `k:${code}:${over.dimension ?? ""}:${over.price_field ?? "unit_price"}`, code, price_field: "unit_price", dimension: "", finishes: [], price, currency: "EUR", row_keys: ["r"], issues: [], evidence: [{ row_number: 7, sheet: "S1", full_supplier_code: code }], ...over });
const base = (identities: SourceIdentity[] = [], extra: Tables = {}): Tables => ({
  brands: [{ id: "b1" }, { id: "b2" }],
  supplier_source_definitions: [{ id: "d1", brand_id: "b1", is_active: true }, { id: "d2", brand_id: "b2", is_active: true }],
  supplier_source_versions: [version(), version({ id: "v2", brand_id: "b2", definition_id: "d2" })],
  supplier_source_identities: identities.map((data) => ({ source_id: "v1", key: data.key, code: data.code, data })),
  supplier_dimension_vocabulary: [], supplier_price_bindings: [], ...extra,
});
const priced = (id: string, code: string | null, price: number | null, extra: Record<string, unknown> = {}) => ({ id, label: id, displayName: null, dimensions: null, currency: "EUR" as const, price, specification: null, supplierCodes: code ? [code] : [], referenceCodes: [], ...extra });
const draft = (pricing: Record<string, unknown>, optionGroups: unknown[] = []): ProductTemplateDraft => ({ version: 1, template: { supplierCodes: [], referenceCodes: [], templateName: "T", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null }, defaultCurrency: "EUR",
  pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [], ...pricing }, optionGroups, materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [] }) as unknown as ProductTemplateDraft;
const cellsOf = (pricing: Record<string, unknown>, options: unknown[] = []) => projectDraftPricing(draft(pricing, options)).cells;

async function check(tables: Tables, cells: SmartSetupPriceCell[], over: Record<string, unknown> = {}) {
  const { client, calls } = fakeClient(tables);
  const out = await runSmartSetupSupplierCheck({ requireReviewer: async () => ({}), getClient: async () => client }, { brandId: "b1", definitionId: "d1", sourceVersionId: "v1", cells, ...over });
  assert.ok(!calls.some((c) => c.startsWith("WRITE")), "no writes");
  return out.results;
}
const by = (results: Awaited<ReturnType<typeof check>>, locator: string) => results.find((r) => r.locator === locator)!;
const optionGroup = (items: unknown[], extra: Record<string, unknown> = {}) => ({ id: "og", label: null, selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items, ...extra });

test("Base / Model: same price MATCHED, different MISMATCH, absent NOT_FOUND, with locator and evidence", async () => {
  const cells = cellsOf({ baseModelRows: [priced("m1", "A1", 100), priced("m2", "A2", 120), priced("m3", "A3", 50)] });
  const r = await check(base([identity("A1", 100), identity("A2", 110)]), cells);
  assert.deepEqual([by(r, "base_model:legacy:m1").status, by(r, "base_model:legacy:m2").status, by(r, "base_model:legacy:m3").status], ["MATCHED", "MISMATCH", "NOT_FOUND"]);
  assert.equal(by(r, "base_model:legacy:m2").referencePrice, 110); assert.equal(by(r, "base_model:legacy:m2").importedPrice, 120);
  assert.deepEqual(by(r, "base_model:legacy:m1").evidence, { identityKey: "k:A1::unit_price", sheet: "S1", rowNumber: 7, sourceRowCount: null });
  assert.equal(by(r, "base_model:legacy:m3").referencePrice, null); assert.equal(by(r, "base_model:legacy:m3").evidence, null);
  assert.equal(by(r, "base_model:legacy:m1").source.versionId, "v1");
});

test("Category / Matrix: per-cell dimension; unavailable and absent cells are skipped", () => {
  const cells = cellsOf({ priceMatrices: [{ id: "pm", label: null, columns: [{ id: "ca", label: "Cat A" }, { id: "cb", label: "Cat B", dimensionCode: "cat_b" }, { id: "cc", label: "Cat C" }], rows: [{ ...priced("r1", "M1", 0), prices: { ca: 10, cb: 20, cc: 30 }, unavailableCategoryIds: ["cc"] }] }] });
  assert.deepEqual(cells.map((c) => [c.locator, c.dimension, c.price]), [["price_matrix:pm:r1:ca", "cat_a", 10], ["price_matrix:pm:r1:cb", "cat_b", 20]]);
});

test("Category / Matrix check: dimension tier decides the match; same code in a different context is never MISMATCH", async () => {
  const cells = cellsOf({ priceMatrices: [{ id: "pm", label: null, columns: [{ id: "ca", label: "Cat A" }, { id: "cb", label: "Cat B" }], rows: [{ ...priced("r1", "M1", 0), prices: { ca: 10, cb: 99 } }] }] });
  const r = await check(base([identity("M1", 10, { dimension: "cat_a" }), identity("M1", 20, { dimension: "cat_b" })]), cells);
  assert.equal(by(r, "price_matrix:pm:r1:ca").status, "MATCHED");
  assert.equal(by(r, "price_matrix:pm:r1:cb").status, "MISMATCH"); assert.equal(by(r, "price_matrix:pm:r1:cb").referencePrice, 20);
  const r2 = await check(base([identity("M1", 10, { dimension: "cat_z" })]), cells);
  assert.ok(r2.every((x) => x.status === "NEEDS_REVIEW" && x.reason === "needs_dimension_mapping"));
});

test("LAS matrix category binding: a confirmed Brand dimension rule maps the source tier to the draft column", async () => {
  const cells = cellsOf({ priceMatrices: [{ id: "pm", label: null, columns: [{ id: "c1", label: "Category 1", dimensionCode: "category_1" }], rows: [{ ...priced("r1", "LAS1", 0), prices: { c1: 55 } }] }] });
  const rule: DimensionRule = { id: "x", brand_id: "b1", raw_labels: ["SG1"], finish_codes: [], dimension_code: "category_1" };
  assert.equal((await check(base([identity("LAS1", 55, { dimension: "category_1", raw_dimension: "SG1" })], { supplier_dimension_vocabulary: [{ ...rule, is_active: true } as never] }), cells))[0].status, "MATCHED");
  assert.equal((await check(base([identity("LAS1", 55, { dimension: "sg1" })]), cells))[0].status, "NEEDS_REVIEW");
});

test("Modular direct and category pricing become separate cells with roles", () => {
  const cells = cellsOf({ modularGroups: [
    { id: "g1", label: null, defaultDimensions: null, defaultSpecification: null, pricingMode: "direct", directRows: [priced("d1", "MD1", 5, { role: "starter" })] },
    { id: "g2", label: null, defaultDimensions: null, defaultSpecification: null, pricingMode: "matrix", matrix: { id: "mx", label: null, columns: [{ id: "k1", label: "K1" }], rows: [{ ...priced("m1", "MC1", 0), prices: { k1: 7 }, role: "intermediate" }] } },
  ] });
  assert.deepEqual(cells.map((c) => [c.locator, c.architecture, c.role, c.price]), [["modular_direct:g1:d1", "modular_direct", "starter", 5], ["modular_matrix:g2:m1:k1", "modular_matrix", "intermediate", 7]]);
});

test("Accessory direct and category-priced options", () => {
  const cells = cellsOf({}, [optionGroup([priced("i1", "AC1", 9), { ...priced("i2", "AC2", null), prices: { pa: 12 } }], { priceCategories: [{ id: "pa", label: "PA" }] })]);
  assert.deepEqual(cells.map((c) => [c.locator, c.architecture, c.price]), [["option:og:i1", "option_direct", 9], ["option:og:i2:pa", "option_category", 12]]);
});

test("Workstation default and additional prices are separate price fields", async () => {
  const cells = cellsOf({ workstationRows: [{ ...priced("w1", "WS1", 100), additionalPrice: 40, layoutType: null }] });
  assert.deepEqual(cells.map((c) => [c.priceField, c.price]), [["default_price", 100], ["additional_price", 40]]);
  const r = await check(base([identity("WS1", 100, { price_field: "default_price" }), identity("WS1", 45, { price_field: "additional_price" })]), cells);
  assert.deepEqual([by(r, "workstation:legacy:w1:default").status, by(r, "workstation:legacy:w1:additional").status], ["MATCHED", "MISMATCH"]);
});

test("Native System/Base and Main Product rows stay separate and keep their role", async () => {
  const cells = cellsOf({ baseModelRows: [priced("main", "MP1", 100, { groupId: "g" }), priced("sys", "SB1", 30, { groupId: "g", role: "system_base" })] });
  assert.deepEqual(cells.map((c) => c.role), ["main_product", "system_base"]);
  const r = await check(base([identity("MP1", 100), identity("SB1", 35)]), cells);
  assert.deepEqual([by(r, "base_model:g:main").status, by(r, "base_model:g:sys").status, by(r, "base_model:g:sys").role], ["MATCHED", "MISMATCH", "system_base"]);
});

test("Interstuhl shared option code: two source contexts for one cell is NEEDS_REVIEW, never the first match", async () => {
  const cells = cellsOf({}, [optionGroup([priced("i1", "OPT", 10)])]);
  const r = await check(base([identity("OPT", 10, { key: "a" }), identity("OPT", 99, { key: "b" })]), cells);
  assert.deepEqual([r[0].status, r[0].reason, r[0].referencePrice], ["NEEDS_REVIEW", "ambiguous_source_contexts", null]);
});

test("True Design shared price: rows sharing a code are review-only until a confirmed shared binding exists", async () => {
  const cells = cellsOf({ baseModelRows: [priced("a", "TD1", 10), priced("b", "TD1", 10)] });
  const ids = [identity("TD1", 10)];
  assert.ok((await check(base(ids), cells)).every((x) => x.status === "NEEDS_REVIEW" && x.reason === "shared_price_unconfirmed"));
  const binding: DurableBinding = { id: "bd", code: "TD1", price_field: "unit_price", source_dimension: "", target_keys: ["persisted"], kind: "shared", confirmed: true };
  assert.deepEqual((await check(base(ids, { supplier_price_bindings: [{ ...binding, brand_id: "b1" } as never] }), cells)).map((x) => x.status), ["MATCHED", "MATCHED"]);
  const differing = cellsOf({ baseModelRows: [priced("a", "TD1", 10), priced("b", "TD1", 12)] });
  assert.ok((await check(base(ids, { supplier_price_bindings: [{ ...binding, brand_id: "b1" } as never] }), differing)).every((x) => x.reason === "shared_price_baseline_drift"));
});

test("Missing or multiple supplier codes and currency are unsupported, never fabricated", () => {
  const { cells, unsupported } = projectDraftPricing(draft({ baseModelRows: [priced("a", null, 1), priced("b", "X", 1, { supplierCodes: ["X", "Y"] }), priced("c", "OK", 1)] }));
  assert.deepEqual(unsupported.map((u) => u.reason), ["missing_supplier_code", "multiple_supplier_codes"]); assert.equal(cells.length, 1);
  const none = projectDraftPricing({ ...draft({ baseModelRows: [priced("d", "Z", 1, { currency: null })] }), defaultCurrency: null });
  assert.equal(none.unsupported[0].reason, "missing_currency");
});

test("Null is missing evidence, zero is a real price", async () => {
  const cells = cellsOf({ baseModelRows: [priced("n", "N1", null), priced("z", "Z1", 0), priced("z2", "Z2", 0)] });
  const r = await check(base([identity("N1", 0), identity("Z1", 0), identity("Z2", 5)]), cells);
  assert.deepEqual([by(r, "base_model:legacy:n").status, by(r, "base_model:legacy:n").reason], ["NEEDS_REVIEW", "missing_draft_price"]);
  assert.equal(by(r, "base_model:legacy:z").status, "MATCHED"); assert.equal(by(r, "base_model:legacy:z2").status, "MISMATCH");
  assert.equal((await check(base([identity("Z1", null)]), cells.filter((c) => c.code === "Z1")))[0].status, "NEEDS_REVIEW");
});

test("Currency and basis incompatibility need review", async () => {
  const cells = cellsOf({ baseModelRows: [priced("a", "C1", 10)] });
  assert.equal((await check(base([identity("C1", 10, { currency: "USD" })]), cells))[0].reason, "currency_mismatch");
  const r = await check(base([identity("C1", 10)]), cells, { priceBasis: "net" });
  assert.deepEqual([r[0].status, r[0].reason], ["NEEDS_REVIEW", "basis_mismatch"]);
  assert.equal((await check(base([identity("C1", 10)]), cells, { priceBasis: "list" }))[0].status, "MATCHED");
});

test("Source version rules: archived, future, superseded, unknown basis, cross-brand and cross-definition ids are rejected", async () => {
  const cells = cellsOf({ baseModelRows: [priced("a", "C1", 10)] });
  const rejects = (tables: Tables, over: Record<string, unknown> = {}) => assert.rejects(check(tables, cells, over));
  await rejects(base([], { supplier_source_versions: [version({ status: "archived" })] }));
  await rejects(base([], { supplier_source_versions: [version({ effective_from: "2999-01-01" })] }));
  await rejects(base([], { supplier_source_versions: [version(), version({ id: "v9", effective_from: today, created_at: "2025-01-01" })] }));
  await rejects(base([], { supplier_source_versions: [version({ basis: "unknown" })] }));
  await rejects(base(), { sourceVersionId: "v2" });
  await rejects(base(), { definitionId: "d2" });
  await rejects(base(), { brandId: "b2" });
  await rejects(base(), { brandId: "nope" });
});

test("Request bounds", async () => {
  const cells = cellsOf({ baseModelRows: [priced("a", "C1", 10)] });
  await assert.rejects(check(base(), []));
  await assert.rejects(check(base(), Array.from({ length: SMART_SETUP_CHECK_MAX_CELLS + 1 }, (_, i) => ({ ...cells[0], locator: `l${i}` }))));
  await assert.rejects(check(base(), [cells[0], cells[0]]));
  await assert.rejects(check(base(), [{ ...cells[0], currency: "XXX" as never }]));
  await assert.rejects(check(base(), [{ ...cells[0], price: -1 }]));
});

test("Unauthorized reviewer is rejected before any client or database access", async () => {
  let touched = false;
  await assert.rejects(runSmartSetupSupplierCheck({ requireReviewer: async () => { throw Error("redirect"); }, getClient: async () => { touched = true; return fakeClient(base()).client; } }, { brandId: "b1", definitionId: "d1", sourceVersionId: "v1", cells: [] }), /redirect/);
  assert.equal(touched, false);
});
