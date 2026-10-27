import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listReviewDecisions, listCarryOverDecisions, saveReviewDecisions } from "./supplier-review-decision-service";

const source = "19b00000-0000-0000-0002-000000000001";
const payload = { supplier_source_id: source, supplier_price_list_label: "List", model_code: "A1", price_field: "unit_price", category: null, imported_price: 120, supplier_price: 100, currency: "EUR", decision: "use_supplier", custom_price: null, note: null, status: "open" };
function deps(role = "system_owner", error: unknown = null) {
  const calls: unknown[] = [];
  return { calls, deps: { getProfile: async () => ({ role, account_status: "active" }), getClient: async () => ({ rpc: async (...args: unknown[]) => { calls.push(args); return { data: [], error }; } }) as unknown as SupabaseClient } };
}
test("all non-managers are rejected before any decision RPC", async () => {
  for (const role of ["procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer", "warehouse_staff"]) {
    const d = deps(role);
    await assert.rejects(listReviewDecisions(d.deps, source), /Only/);
    await assert.rejects(saveReviewDecisions(d.deps, [payload]), /Only/);
    await assert.rejects(listCarryOverDecisions(d.deps, source), /Only/);
    assert.deepEqual(d.calls, []);
  }
});
test("carry-over reads use only the manager-gated RPC and reject bad sources before RPC", async () => {
  const d = deps("admin_manager");
  await listCarryOverDecisions(d.deps, source);
  assert.deepEqual(d.calls, [["list_carry_over_decisions", { p_supplier_source_id: source }]]);
  await assert.rejects(listCarryOverDecisions(d.deps, "bad"), /valid supplier/);
  assert.equal(d.calls.length, 1);
  const failed = deps("system_owner", { message: "internal database details" });
  await assert.rejects(listCarryOverDecisions(failed.deps, source), /Earlier decisions could not be loaded/);
});
test("managers call only the decision RPC; malformed, oversized and duplicate payloads never reach it", async () => {
  const d = deps("admin_manager");
  await listReviewDecisions(d.deps, source); await saveReviewDecisions(d.deps, [payload]);
  assert.deepEqual(d.calls, [["list_supplier_price_decisions", { p_supplier_source_id: source }], ["save_supplier_price_decisions", { p_decisions: [payload] }]]);
  for (const bad of [null, [], Array(201).fill(payload), [payload, payload], [{ ...payload, note: "a".repeat(501) }]]) await assert.rejects(saveReviewDecisions(d.deps, bad));
  await assert.rejects(listReviewDecisions(d.deps, "bad")); assert.equal(d.calls.length, 2);
});
test("RPC errors are plain English, not internal database details", async () => {
  const d = deps("system_owner", { message: "secret database details" });
  await assert.rejects(listReviewDecisions(d.deps, source), /^Error: Saved decisions could not be loaded/);
  await assert.rejects(saveReviewDecisions(d.deps, [payload]), /^Error: Decisions could not be saved/);
});
