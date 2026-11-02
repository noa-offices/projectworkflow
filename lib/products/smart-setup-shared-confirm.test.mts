import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runSmartSetupSupplierCheck, type SmartSetupSupplierCheckResult } from "./smart-setup-supplier-check.js";
import { applySharedConfirmations, sharedCodeGroups } from "./smart-setup-shared-confirm.js";
import type { SmartSetupPriceCell } from "./smart-setup-supplier-targets.js";
import type { SourceIdentity } from "./supplier-price-contracts.js";

type Tables = Record<string, Array<Record<string, unknown>>>;
function fakeClient(tables: Tables) {
  const builder = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const api: Record<string, unknown> = {
      select: () => api, order: () => api, range: () => api, neq: () => api, gt: () => api, returns: () => api,
      eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return api; },
      in: (k: string, v: unknown[]) => { rows = rows.filter((r) => v.includes(r[k])); return api; },
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return api;
  };
  const forbidden = () => { throw Error("write attempted"); };
  return { from: builder, rpc: forbidden, storage: { from: forbidden } } as unknown as SupabaseClient;
}
const identity = (code: string, price: number | null, issues: string[] = []): SourceIdentity => ({ key: `k:${code}`, code, price_field: "unit_price", dimension: "", raw_dimension: "", finishes: [], price, currency: "EUR", row_keys: [], issues, evidence: [{ sheet: "S1", row_number: 7 }] }) as unknown as SourceIdentity;
const cell = (locator: string, code: string, price: number | null, over: Partial<SmartSetupPriceCell> = {}): SmartSetupPriceCell => ({ locator, architecture: "base_model", role: "main_product", groupId: "g", rowId: locator, columnId: "", label: locator, code, priceField: "unit_price", price, currency: "EUR", dimension: "", ...over });
async function run(identities: SourceIdentity[], cells: SmartSetupPriceCell[]) {
  const tables: Tables = {
    brands: [{ id: "b1" }], supplier_source_definitions: [{ id: "d1", brand_id: "b1", is_active: true }],
    supplier_source_versions: [{ id: "v1", brand_id: "b1", definition_id: "d1", status: "imported", effective_from: null, created_at: "2024-01-01", currency: "EUR", basis: "list", title: "List" }],
    supplier_source_identities: identities.map((data) => ({ source_id: "v1", key: data.key, code: data.code, data })), supplier_dimension_vocabulary: [], supplier_price_bindings: [],
  };
  return (await runSmartSetupSupplierCheck({ requireReviewer: async () => ({}), getClient: async () => fakeClient(tables) }, { brandId: "b1", definitionId: "d1", sourceVersionId: "v1", cells })).results;
}
const counts = (results: SmartSetupSupplierCheckResult[]) => results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});

test("two rows, same code, same price as the supplier: the check says shared, the button is offered, confirming makes both Matched", async () => {
  const results = await run([identity("3283", 100)], [cell("a", "3283", 100), cell("b", "3283", 100)]);
  assert.deepEqual(results.map((r) => [r.status, r.reason, r.referencePrice]), [["NEEDS_REVIEW", "shared_price_unconfirmed", null], ["NEEDS_REVIEW", "shared_price_unconfirmed", null]]);
  const [group] = [...sharedCodeGroups(results).values()];
  assert.equal(group.canConfirm, true); assert.deepEqual(group.locators, ["a", "b"]);
  const confirmed = applySharedConfirmations(results, new Set([group.key]));
  assert.deepEqual(confirmed.map((r) => [r.status, r.reason, r.referencePrice, r.referenceCurrency]), [["MATCHED", "same_price", 100, "EUR"], ["MATCHED", "same_price", 100, "EUR"]]);
  assert.deepEqual(counts(confirmed), { MATCHED: 2 });
  assert.equal(results[0].status, "NEEDS_REVIEW", "the check result itself is never changed");
});

test("undo: removing the code from the confirmed set brings the rows back to Needs review", async () => {
  const results = await run([identity("3283", 100)], [cell("a", "3283", 100), cell("b", "3283", 100)]);
  const key = [...sharedCodeGroups(results).keys()][0];
  assert.deepEqual(counts(applySharedConfirmations(results, new Set([key]))), { MATCHED: 2 });
  assert.deepEqual(counts(applySharedConfirmations(results, new Set())), { NEEDS_REVIEW: 2 });
});

test("the draft price differs from the supplier price: no button, still Needs review, with a plain reason", async () => {
  const results = await run([identity("3283", 100)], [cell("a", "3283", 90), cell("b", "3283", 90)]);
  const [group] = [...sharedCodeGroups(results).values()];
  assert.deepEqual([group.canConfirm, group.differs], [false, true]);
  const forced = applySharedConfirmations(results, new Set([group.key]));
  assert.deepEqual(counts(forced), { NEEDS_REVIEW: 2 }, "even a forced confirmation cannot make a different price Matched");
});

test("a null supplier price (the 903/904 case) gets no button", async () => {
  const results = await run([identity("903", null)], [cell("a", "903", 100), cell("b", "903", 100)]);
  assert.ok(results.every((r) => r.reason !== "shared_price_unconfirmed"));
  assert.equal(sharedCodeGroups(results).size, 0);
  const unusable = await run([identity("904", 100, ["bad"])], [cell("a", "904", 100), cell("b", "904", 100)]);
  assert.equal(sharedCodeGroups(unusable).size, 0);
});

test("a single row, or rows with different price fields, get no button", async () => {
  const one = await run([identity("3283", 100)], [cell("a", "3283", 100)]);
  assert.equal(sharedCodeGroups(one).size, 0);
  const mixed = [...await run([identity("3283", 100)], [cell("a", "3283", 100), cell("b", "3283", 100)])];
  const fields = mixed.map((r, i) => (i === 1 ? { ...r, priceField: "additional_price" } : r));
  assert.equal([...sharedCodeGroups(fields).values()][0].canConfirm, false);
});

test("a different currency on a row blocks the button", async () => {
  const results = await run([identity("3283", 100)], [cell("a", "3283", 100), cell("b", "3283", 100)]);
  const usd = results.map((r, i) => (i === 1 ? { ...r, importedCurrency: "USD" } : r));
  assert.equal([...sharedCodeGroups(usd).values()][0].canConfirm, false);
});

test("an ordinary single-code match is not affected", async () => {
  const results = await run([identity("A1", 100)], [cell("a", "A1", 100)]);
  assert.equal(results[0].status, "MATCHED"); assert.equal(results[0].sharedCandidate, undefined);
  assert.deepEqual(applySharedConfirmations(results, new Set(["A1"])), results);
});
