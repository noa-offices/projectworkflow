import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runSmartSetupSupplierCheck } from "./smart-setup-supplier-check.js";
import { loadSmartSetupFamilyState, smartSetupFamilyScope } from "./smart-setup-supplier-families.js";
import type { SmartSetupPriceCell } from "./smart-setup-supplier-targets.js";
import { SMART_SETUP_TEMPLATE_ID } from "./smart-setup-supplier-targets.js";
import type { SourceIdentity } from "./supplier-price-contracts.js";

type Tables = Record<string, Array<Record<string, unknown>>>;
type Rpc = Record<string, unknown[]>;
/** Reads and the four read-only family functions work; any other rpc is a write and fails the test. */
function fakeClient(tables: Tables, rpcs: Rpc = {}) {
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
  const rpc = async (name: string) => {
    if (!(name in rpcs)) { calls.push(`WRITE:rpc:${name}`); throw Error(`write attempted: ${name}`); }
    calls.push(`rpc:${name}`); return { data: rpcs[name], error: null };
  };
  const forbidden = (name: string) => () => { calls.push(`WRITE:${name}`); throw Error(`write attempted: ${name}`); };
  return { client: { from: builder, rpc, storage: { from: forbidden("storage") } } as unknown as SupabaseClient, calls };
}

const version = { id: "v1", brand_id: "b1", definition_id: "d1", status: "imported", effective_from: null, created_at: "2024-01-01", currency: "EUR", basis: "list", title: "INTERSTUHL 2024" };
const tag = (family: string) => JSON.stringify(["", "series", family]);
const id = (key: string, code: string, price: number, dimension = ""): SourceIdentity => ({ key, code, price_field: "unit_price", dimension, raw_dimension: "", finishes: [], price, currency: "EUR", row_keys: [], issues: [], evidence: [{ sheet: "S1", row_number: 7 }] }) as unknown as SourceIdentity;
const tables = (identities: SourceIdentity[]): Tables => ({
  brands: [{ id: "b1" }], supplier_source_definitions: [{ id: "d1", brand_id: "b1", is_active: true }], supplier_source_versions: [version],
  supplier_source_identities: identities.map((data) => ({ source_id: "v1", key: data.key, code: data.code, data })),
  supplier_dimension_vocabulary: [], supplier_price_bindings: [],
});
const cell = (locator: string, code: string, price: number | null): SmartSetupPriceCell => ({ locator, architecture: "base_model", role: "main_product", groupId: "g", rowId: locator, columnId: "", label: locator, code, priceField: "unit_price", price, currency: "EUR", dimension: "" });
const familyRows = [{ family: "AIM", family_key: "aim", identity_count: 2 }, { family: "EVERY", family_key: "every", identity_count: 2 }];
// The same code in two families with different prices: only the chosen family may decide.
const repeated = [id("aim", "521234", 57, tag("AIM")), id("every", "521234", 58, tag("EVERY")), id("plain", "999001", 10)];
const input = { brandId: "b1", definitionId: "d1", sourceVersionId: "v1" };

async function check(rpcs: Rpc, cells: SmartSetupPriceCell[], extra: Record<string, unknown> = {}, identities = repeated) {
  const { client, calls } = fakeClient(tables(identities), rpcs);
  const out = await runSmartSetupSupplierCheck({ requireReviewer: async () => ({}), getClient: async () => client }, { ...input, cells, ...extra });
  assert.ok(!calls.some((c) => c.startsWith("WRITE")), "no writes");
  return { results: out.results, calls };
}
const by = (results: Awaited<ReturnType<typeof check>>["results"], locator: string) => results.find((r) => r.locator === locator)!;
const saved = (family: string, key: string, templateId = "T1") => ({ definition_id: "d1", template_id: templateId, family, family_key: key });
const rpcs = (savedRows: unknown[] = []) => ({ supplier_source_families: familyRows, supplier_template_series_list: savedRows, supplier_template_series_missing: [] });

test("scope builder: draft targets share one transient template id; no keys means no scope", () => {
  assert.equal(smartSetupFamilyScope([]), undefined);
  assert.deepEqual([...smartSetupFamilyScope(["every"])!], [[SMART_SETUP_TEMPLATE_ID, new Set(["every"])]]);
});

test("saved template: its saved family reaches the matcher (golden: repeated code, two families, two prices)", async () => {
  const every = await check(rpcs([saved("EVERY", "every")]), [cell("c1", "521234", 58)], { templateId: "T1" });
  assert.deepEqual([by(every.results, "c1").status, by(every.results, "c1").referencePrice], ["MATCHED", 58]);
  assert.ok(every.calls.includes("rpc:supplier_template_series_list"));
  const aim = await check(rpcs([saved("AIM", "aim")]), [cell("c1", "521234", 58)], { templateId: "T1" });
  assert.deepEqual([by(aim.results, "c1").status, by(aim.results, "c1").referencePrice], ["MISMATCH", 57]);
  // Another product's saved family does not leak into this draft.
  const other = await check(rpcs([saved("EVERY", "every", "T2")]), [cell("c1", "521234", 58)], { templateId: "T1" });
  assert.deepEqual([by(other.results, "c1").status, by(other.results, "c1").reason], ["NEEDS_REVIEW", "choose_family"]);
});

test("new unsaved product: family names chosen on screen reach the matcher and win over anything saved", async () => {
  const r = await check(rpcs(), [cell("c1", "521234", 58)], { familyNames: ["  every "] });
  assert.deepEqual([by(r.results, "c1").status, by(r.results, "c1").referencePrice], ["MATCHED", 58]);
  assert.ok(!r.calls.includes("rpc:supplier_template_series_list"), "nothing saved is read for names given on screen");
  const both = await check(rpcs([saved("AIM", "aim")]), [cell("c1", "521234", 58)], { templateId: "T1", familyNames: ["EVERY"] });
  assert.equal(by(both.results, "c1").status, "MATCHED");
});

test("two chosen families with different prices for one code are never resolved", async () => {
  const r = await check(rpcs(), [cell("c1", "521234", 58)], { familyNames: ["AIM", "EVERY"] });
  assert.equal(by(r.results, "c1").status, "NEEDS_REVIEW"); assert.equal(by(r.results, "c1").referencePrice, null);
});

test("a family name the price list does not contain is dropped, never guessed", async () => {
  const r = await check(rpcs(), [cell("c1", "521234", 58)], { familyNames: ["Not a family"] });
  assert.equal(by(r.results, "c1").reason, "choose_family");
});

test("guard: families in the list and none chosen: family-tagged codes ask for a family, other codes are still compared", async () => {
  const { results, calls } = await check(rpcs(), [cell("c1", "521234", 58), cell("c2", "999001", 10), cell("c3", "777", 5)]);
  assert.deepEqual([by(results, "c1").status, by(results, "c1").reason, by(results, "c1").referencePrice, by(results, "c1").evidence], ["NEEDS_REVIEW", "choose_family", null, null]);
  assert.equal(by(results, "c2").status, "MATCHED"); assert.equal(by(results, "c3").status, "NOT_FOUND");
  assert.ok(!calls.some((c) => c.startsWith("rpc:")), "no scope given: no family function is even called");
});

test("no scope and no family-tagged lines: exactly as before (no rpc at all)", async () => {
  const plain = [id("a", "A1", 100), id("b", "A2", 110)];
  const { results, calls } = await check({}, [cell("m1", "A1", 100), cell("m2", "A2", 120)], {}, plain);
  assert.deepEqual([by(results, "m1").status, by(results, "m2").status], ["MATCHED", "MISMATCH"]);
  assert.ok(!calls.some((c) => c.startsWith("rpc:")));
});

test("a null draft price is still never compared when a family is chosen", async () => {
  const r = await check(rpcs(), [cell("c1", "521234", null)], { familyNames: ["EVERY"] });
  assert.equal(by(r.results, "c1").status, "NEEDS_REVIEW"); assert.equal(by(r.results, "c1").reason, "missing_draft_price");
});

test("roles: an unauthorized caller reads nothing, even with a template id and family names", async () => {
  const { client, calls } = fakeClient(tables(repeated), rpcs());
  await assert.rejects(runSmartSetupSupplierCheck({ requireReviewer: async () => { throw Error("denied"); }, getClient: async () => { calls.push("client"); return client; } }, { ...input, cells: [cell("c1", "521234", 58)], templateId: "T1", familyNames: ["EVERY"] }), /denied/);
  assert.deepEqual(calls, []);
});

test("bad family input is refused before any read of families", async () => {
  await assert.rejects(check(rpcs(), [cell("c1", "521234", 58)], { familyNames: "EVERY" }), /Family names are not valid/);
  await assert.rejects(check(rpcs(), [cell("c1", "521234", 58)], { familyNames: [1] }), /Family names are not valid/);
});

test("loading the family state is read-only and reports chosen and missing for the saved template only", async () => {
  const { client, calls } = fakeClient(tables([]), { ...rpcs([saved("EVERY", "every"), saved("AIM", "aim", "T2")]), supplier_template_series_missing: [{ template_id: "T1", family: "OLD", family_key: "old" }, { template_id: "T2", family: "X", family_key: "x" }] });
  const state = await loadSmartSetupFamilyState(client, { definitionId: "d1", versionId: "v1", templateId: "T1" });
  assert.deepEqual(state.families.map((f) => f.key), ["aim", "every"]);
  assert.deepEqual(state.chosen, [{ family: "EVERY", key: "every" }]); assert.deepEqual(state.missing, [{ family: "OLD", key: "old" }]);
  const fresh = await loadSmartSetupFamilyState(client, { definitionId: "d1", versionId: "v1" });
  assert.deepEqual([fresh.chosen, fresh.missing], [[], []]);
  assert.ok(calls.every((c) => c.startsWith("rpc:")), "only read functions were called");
  // A list without families has nothing to choose: no per-product reads either.
  const none = fakeClient(tables([]), { supplier_source_families: [], supplier_template_series_list: [], supplier_template_series_missing: [] });
  assert.deepEqual(await loadSmartSetupFamilyState(none.client, { definitionId: "d1", versionId: "v1", templateId: "T1" }), { families: [], chosen: [], missing: [] });
  assert.deepEqual(none.calls, ["rpc:supplier_source_families"]);
});
