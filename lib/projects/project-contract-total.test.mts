import assert from "node:assert/strict";
import test from "node:test";
import { projectContractTotal, loadProjectContractTotals } from "./project-contract-total.js";

test("no applied variation keeps the stored original exactly", () => {
  for (const state of [undefined, null, { applied_variation_no: null, contract_total: 99 }, { applied_variation_no: 1, contract_total: null }]) {
    assert.deepEqual(projectContractTotal(1468.95, state), { originalTotal: 1468.95, currentTotal: 1468.95, appliedVariationNo: null, variationDelta: 0 });
  }
});
test("latest applied variation wins, including a credit", () => {
  assert.deepEqual(projectContractTotal(1000, { applied_variation_no: 1, contract_total: 1200 }), { originalTotal: 1000, currentTotal: 1200, appliedVariationNo: 1, variationDelta: 200 });
  assert.deepEqual(projectContractTotal(1000, [{ applied_variation_no: 2, contract_total: 900 }, { applied_variation_no: 1, contract_total: 1200 }]), { originalTotal: 1000, currentTotal: 900, appliedVariationNo: 2, variationDelta: -100 });
});
test("loader deduplicates and batches 101 ids, skips empty, uses latest state", async () => {
  const calls: string[][] = [];
  const client = { async rpc(name: string, args: { p_quotation_ids: string[] }) {
    assert.equal(name, "project_variation_state"); calls.push(args.p_quotation_ids);
    return { error: null, data: args.p_quotation_ids.flatMap((id) => [{ quotation_id: id, applied_variation_no: 1, contract_total: 1200 }, { quotation_id: id, applied_variation_no: 2, contract_total: 900 }]) };
  } };
  assert.equal((await loadProjectContractTotals(client, [])).size, 0);
  assert.equal(calls.length, 0);
  const ids = Array.from({ length: 101 }, (_, i) => `q-${i}`);
  const state = await loadProjectContractTotals(client, [...ids, ids[0]]);
  assert.deepEqual(calls.map((call) => call.length), [50, 50, 1]);
  assert.equal(projectContractTotal(1000, state.get(ids[0])).currentTotal, 900);
});
test("missing RPC, failed batch, thrown call and malformed state fall back without breaking screens", async () => {
  for (const client of [{}, { rpc: async () => ({ data: null, error: { code: "PGRST202" } }) }, { rpc: async () => { throw Error("offline"); } }, { rpc: async () => ({ data: [{ quotation_id: "q", applied_variation_no: 1, contract_total: "not money" }], error: null }) }]) {
    const states = await loadProjectContractTotals(client, ["q"]);
    assert.equal(states.size, 0);
    assert.equal(projectContractTotal(1000, states.get("q")).currentTotal, 1000);
  }
});
