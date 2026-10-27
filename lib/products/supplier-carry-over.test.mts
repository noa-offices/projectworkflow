import assert from "node:assert/strict";
import test from "node:test";
import { classifyCarryOverRows, type CarryOverDecision, type CurrentReviewPrice } from "./supplier-carry-over";
import type { SavedReviewDecision } from "./supplier-review-decisions";

const current = (over: Partial<CurrentReviewPrice> = {}): CurrentReviewPrice => ({ model_code: "A1", price_field: "unit_price", supplier_price: 100, currency: "EUR", usable_supplier_price: true, ...over });
const earlier = (over: Partial<CarryOverDecision> = {}): CarryOverDecision => ({ model_code: "A1", price_field: "unit_price", category: "Standard", decision: "use_supplier", custom_price: null, note: "Checked", imported_price: 120, supplier_price: 100, currency: "EUR", decided_at: "2026-10-01T00:00:00Z", decided_by_name: "Olivia Carry Owner", from_source_id: "old", from_label: "Old list", ...over });
const saved = (over: Partial<SavedReviewDecision> = {}): SavedReviewDecision => ({ ...earlier(), id: "saved", supplier_source_id: "current", supplier_price_list_label: "Current list", status: "open", decided_by: "owner", updated_by: "owner", updated_at: "2026-10-02T00:00:00Z", ...over });
const classify = (rows: CurrentReviewPrice[], saves: SavedReviewDecision[] = [], older: CarryOverDecision[] = []) => classifyCarryOverRows(rows, saves, older);

test("all four states, including current-source cancellation winning over history", () => {
  assert.equal(classify([current()], [saved()], [earlier()])[0].kind, "saved");
  assert.equal(classify([current()], [saved({ status: "cancelled" })], [earlier()])[0].kind, "saved");
  assert.equal(classify([current()], [], [earlier()])[0].kind, "carried_over");
  assert.equal(classify([current({ supplier_price: 101 })], [], [earlier()])[0].kind, "price_changed");
  assert.equal(classify([current()], [], [])[0].kind, "new");
});
test("supplier prices compare numerically to four decimals; null and zero stay distinct", () => {
  assert.equal(classify([current({ supplier_price: 100.00004 })], [], [earlier({ supplier_price: 100 })])[0].kind, "carried_over");
  assert.equal(classify([current({ supplier_price: 100.00006 })], [], [earlier({ supplier_price: 100 })])[0].kind, "price_changed");
  assert.equal(classify([current({ supplier_price: 0 })], [], [earlier({ supplier_price: 0 })])[0].kind, "carried_over");
  assert.equal(classify([current({ supplier_price: null, usable_supplier_price: false })], [], [earlier({ supplier_price: null, decision: "check_later" })])[0].kind, "carried_over");
  assert.equal(classify([current({ supplier_price: 0 })], [], [earlier({ supplier_price: null })])[0].kind, "price_changed");
  assert.equal(classify([current({ supplier_price: null })], [], [earlier({ supplier_price: 0 })])[0].kind, "price_changed");
});
test("currency changes and unusable use_supplier rows require review", () => {
  assert.equal(classify([current({ currency: "USD" })], [], [earlier()])[0].kind, "price_changed");
  assert.equal(classify([current({ supplier_price: null, usable_supplier_price: false })], [], [earlier({ supplier_price: null })])[0].kind, "price_changed");
  assert.equal(classify([current({ supplier_price: null, usable_supplier_price: false })], [], [earlier({ supplier_price: null, decision: "keep_imported" })])[0].kind, "carried_over");
});
test("duplicate current rows classify independently; latest earlier decision wins", () => {
  const rows = [current(), current({ supplier_price: 101 })];
  const older = [earlier({ decision: "ignore", decided_at: "2026-10-02T00:00:00Z" }), earlier({ decision: "check_later", decided_at: "2026-10-03T00:00:00Z" }), earlier({ decision: "keep_imported", decided_at: "2026-10-01T00:00:00Z" })];
  const states = classify(rows, [], older);
  assert.deepEqual(states.map((s) => s.kind), ["carried_over", "price_changed"]);
  assert.equal(states[0].kind === "carried_over" && states[0].earlier.decision, "check_later");
});
