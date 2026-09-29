import assert from "node:assert/strict";
import test from "node:test";
import { computeProcurementReadiness, procurementCompletionWarning } from "./procurement-readiness.ts";
const vendor = (key, confirmed = true, receiving = "received", extra = {}) => ({ vendor_key: key, supplier_confirmed_at: confirmed ? "2026-01-01" : null, receiving_status: receiving, ...extra });
test("zero vendors: not applicable, ready and no completion warning", () => {
  const result = computeProcurementReadiness([]);
  assert.deepEqual(result, { totalVendors: 0, confirmedCount: 0, receivedCount: 0, unconfirmedCount: 0, notReceivedCount: 0, ready: true, applicable: false });
  assert.equal(procurementCompletionWarning(result), null);
});
test("all confirmed and received: ready", () => { const result = computeProcurementReadiness([vendor("a"), vendor("b")]); assert.equal(result.ready, true); assert.equal(procurementCompletionWarning(result), null); });
test("one unconfirmed vendor: correct count and singular warning", () => { const result = computeProcurementReadiness([vendor("a", false)]); assert.equal(result.ready, false); assert.equal(result.unconfirmedCount, 1); assert.equal(procurementCompletionWarning(result), "Procurement is not ready: 1 vendor not confirmed."); });
test("pending receiving: not ready", () => { const result = computeProcurementReadiness([vendor("a", true, "pending")]); assert.equal(result.ready, false); assert.equal(result.notReceivedCount, 1); });
test("partial receiving: not ready", () => { const result = computeProcurementReadiness([vendor("a", true, "partial")]); assert.equal(result.ready, false); assert.equal(result.receivedCount, 0); });
test("mixed vendors: correct aggregate counts and plural warning", () => {
  const result = computeProcurementReadiness([vendor("a", false, "pending"), vendor("b", true, "partial"), vendor("c")]);
  assert.deepEqual(result, { totalVendors: 3, confirmedCount: 2, receivedCount: 1, unconfirmedCount: 1, notReceivedCount: 2, ready: false, applicable: true });
  assert.equal(procurementCompletionWarning(result), "Procurement is not ready: 1 vendor not confirmed · 2 vendors not received.");
});
test("active_step cannot grant or remove readiness", () => {
  assert.equal(computeProcurementReadiness([vendor("a", false, "pending", { active_step: 7 })]).ready, false);
  assert.equal(computeProcurementReadiness([vendor("a", true, "received", { active_step: 0 })]).ready, true);
});
test("ETA/ETD and received_at do not affect readiness", () => {
  const ready = vendor("a", true, "received", { eta: "2099-01-01", etd: null, received_at: null });
  assert.equal(computeProcurementReadiness([ready]).ready, true);
  assert.equal(computeProcurementReadiness([vendor("b", false, "partial", { eta: "2000-01-01", etd: "2000-01-01", received_at: "2026-01-01" })]).ready, false);
});
test("unavailable progress does not claim readiness or not-applicable", () => { assert.match(procurementCompletionWarning(null), /unavailable/); });
