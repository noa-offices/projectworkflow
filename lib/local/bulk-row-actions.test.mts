import assert from "node:assert/strict";
import test from "node:test";
import { bulkDeletePlan, bulkPercentMessage, bulkPercentPatch, canTakeBulkPercent, duplicateRowsBelow, moveRowsToSectionEnd, parseBulkPercent } from "./bulk-row-actions";
import { canMergeHistory, nextHistoryGroup, runInHistoryBatch, withHistoryBatch, type HistoryGroup, type HistoryOptions } from "./history-batch";
import { orderedItems, recalculateWorkspace, type LocalQuotationItem, type LocalQuotationWorkspace } from "./quotation-workspace";

const item = (id: string, sort: number, extra: Partial<LocalQuotationItem> = {}): LocalQuotationItem => ({
  id, quotation_id: "q", section_id: "s1", item_type: "product", source_template_id: null, source_component_data: {}, manual_serial: null,
  item_code_snapshot: null, item_name_snapshot: id, brand_name_snapshot: null, category_name_snapshot: null, specified_image_url_snapshot: null,
  proposed_image_url_snapshot: null, specification_snapshot: null, finish_selections_snapshot: null, selected_options_snapshot: null,
  internal_components_snapshot: null, room_name_snapshot: null, model_snapshot: null, finish_snapshot: null, size_snapshot: null, origin_snapshot: null,
  warranty_snapshot: null, supplier_name_snapshot: null, supplier_notes_snapshot: null, allow_material_continuation_page: false, qty: 2, unit_label: "pcs",
  unit_price: 100, discount_type: "amount", discount_value: 0, net_price: 100, net_total: 200, currency: "AED", sort_order: sort, is_optional: false,
  parent_item_id: null, include_in_total: true, internal_cost: 0, margin_type: "percent", margin_value: 0, is_rate_only: false, line_style: "normal",
  row_height: null, cell_layout: null, is_active: true, notes: null, ...extra,
});
const workspace = (items: LocalQuotationItem[]): LocalQuotationWorkspace => recalculateWorkspace({
  local_id: "l", server_quotation_id: "q", quotation_no: null, title: "T", project_id: null, client_id: "c", status: "draft", currency: "AED",
  updated_at: "", has_unsaved_changes: false, last_saved_to_software_at: null, created_at: "", quotation_date: "2026-11-21", layout_mode: "standard_proposal",
  vat_percent: 5, overall_discount_type: "amount", overall_discount_value: 0, layout_settings: {}, header_snapshot: {}, project_snapshot: {}, client_snapshot: {},
  sections: [
    { id: "s1", quotation_id: "q", section_kind: "sub", section_title: "Ground", parent_section_id: null, sort_order: 0, is_active: true } as never,
    { id: "s2", quotation_id: "q", section_kind: "sub", section_title: "First", parent_section_id: null, sort_order: 1, is_active: true } as never,
  ],
  items, totals: { subtotal: 0, discount_total: 0, overall_discount_amount: 0, net_total: 0, vat_amount: 0, grand_total: 0 }, terms: {}, column_settings: null, metadata: {},
});
const order = (ws: LocalQuotationWorkspace, section = "s1") => orderedItems(ws.items, section).map((entry) => entry.id);

// The builder's commit() history bookkeeping, driven by the same lib helpers it uses, so undo/redo can be tested without React.
function history(initial: LocalQuotationWorkspace) {
  const state = { workspace: initial, past: [] as LocalQuotationWorkspace[], future: [] as LocalQuotationWorkspace[], group: null as HistoryGroup, now: 0 };
  const batchRef = { current: null as string | null };
  const commit = (next: (current: LocalQuotationWorkspace) => LocalQuotationWorkspace, options: HistoryOptions = {}) => {
    const effective = withHistoryBatch(batchRef.current, options);
    const mode = effective.mode ?? "push";
    if (mode !== "skip") {
      const canMerge = canMergeHistory(state.group, effective, state.now, 1200);
      if (!canMerge) state.past.push(state.workspace);
      state.future = [];
      state.group = nextHistoryGroup(state.group, effective, canMerge, state.now);
    }
    state.workspace = recalculateWorkspace(next(state.workspace));
  };
  // Same shapes as the builder: updateItem merges per row (item:<id>), removeItem pushes.
  const updateItem = (id: string, patch: Partial<LocalQuotationItem>) =>
    commit((current) => ({ ...current, items: current.items.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) }), { groupKey: `item:${id}`, mode: "merge" });
  const removeItem = (id: string) => commit((current) => ({ ...current, items: current.items.filter((entry) => entry.id !== id) }));
  const undo = () => { const previous = state.past.pop()!; state.future.unshift(state.workspace); state.workspace = previous; state.group = null; };
  const redo = () => { const [next, ...rest] = state.future; state.future = rest; state.past.push(state.workspace); state.workspace = next; state.group = null; };
  return { state, batchRef, commit, updateItem, removeItem, undo, redo };
}

test("percent: validation 0..100, the single-row field shape, skip rules and message", () => {
  assert.deepEqual(parseBulkPercent("15"), { ok: true, value: 15 });
  assert.deepEqual(parseBulkPercent(" 0 "), { ok: true, value: 0 });
  assert.deepEqual(parseBulkPercent("100"), { ok: true, value: 100 });
  for (const bad of ["", "abc", "-1", "100.5", "1e9"]) assert.equal(parseBulkPercent(bad).ok, false, bad);
  assert.deepEqual(bulkPercentPatch(12.5), { discount_type: "percent", discount_value: 12.5 });
  assert.equal(canTakeBulkPercent({ item_type: "product", line_style: "normal" }), true);
  assert.equal(canTakeBulkPercent({ item_type: "custom", line_style: "normal" }), true);
  for (const itemType of ["note", "blank", "subtotal", "heading"]) assert.equal(canTakeBulkPercent({ item_type: itemType, line_style: "normal" }), false, itemType);
  assert.equal(canTakeBulkPercent({ item_type: "product", line_style: "heading" }), false);
  assert.equal(bulkPercentMessage(3, 0), "Discount set on 3 rows.");
  assert.equal(bulkPercentMessage(1, 2), "Discount set on 1 row (2 skipped: no discount on that row type).");
});

test("bulk discount on 3 rows changes all 3 (not the others), in ONE undo step; one redo reapplies", () => {
  const h = history(workspace([item("A", 0), item("B", 1), item("C", 2), item("D", 3)]));
  runInHistoryBatch(h.batchRef, () => { for (const id of ["A", "B", "C"]) h.updateItem(id, bulkPercentPatch(10)); });
  const after = (id: string) => h.state.workspace.items.find((entry) => entry.id === id)!;
  for (const id of ["A", "B", "C"]) assert.deepEqual([after(id).discount_type, after(id).discount_value, after(id).net_price], ["percent", 10, 90], id);
  assert.deepEqual([after("D").discount_type, after("D").discount_value], ["amount", 0], "unselected rows untouched");
  assert.equal(h.state.past.length, 1, "one history entry");
  h.undo();
  assert.ok(h.state.workspace.items.every((entry) => entry.discount_value === 0), "one undo restores all three");
  h.redo();
  assert.deepEqual(["A", "B", "C"].map((id) => after(id).discount_value), [10, 10, 10], "one redo reapplies");
});

test("totals after a bulk discount equal the totals of the same discount applied row by row with the single-row path", () => {
  const rows = [item("A", 0, { unit_price: 123.45, qty: 3 }), item("B", 1, { unit_price: 999.99 }), item("C", 2, { unit_price: 10, qty: 7 })];
  const bulk = history(workspace(rows));
  runInHistoryBatch(bulk.batchRef, () => { for (const id of ["A", "B", "C"]) bulk.updateItem(id, bulkPercentPatch(12.5)); });
  const single = history(workspace(rows));
  for (const id of ["A", "B", "C"]) { single.state.now += 5000; single.updateItem(id, bulkPercentPatch(12.5)); }
  assert.deepEqual(bulk.state.workspace.totals, single.state.workspace.totals);
  assert.equal(single.state.past.length, 3, "row by row: three undo steps");
});

test("history batch: unique key, never merges into an earlier typing group, nesting joins, cleared in finally, normal edits unchanged", () => {
  const h = history(workspace([item("A", 0), item("B", 1)]));
  h.updateItem("A", { qty: 3 });
  h.state.now = 100;
  runInHistoryBatch(h.batchRef, () => {
    h.updateItem("A", bulkPercentPatch(5));
    runInHistoryBatch(h.batchRef, () => h.updateItem("B", bulkPercentPatch(5)));
  });
  assert.equal(h.state.past.length, 2, "the typing edit and the batch are separate steps, the nested call joined the batch");
  assert.equal(h.batchRef.current, null);
  h.state.now = 200;
  h.updateItem("A", { qty: 4 });
  assert.equal(h.state.past.length, 3, "a normal edit right after a bulk action is its own undo step");
  h.state.now = 900;
  h.updateItem("A", { qty: 5 });
  assert.equal(h.state.past.length, 3, "typing on the same row within 1.2 s still merges");
  h.state.now = 2500;
  h.updateItem("A", { qty: 6 });
  assert.equal(h.state.past.length, 4, "after the 1.2 s window it is a new step");
  assert.throws(() => runInHistoryBatch(h.batchRef, () => { throw new Error("boom"); }));
  assert.equal(h.batchRef.current, null, "cleared even when a helper throws");
  const keys = new Set<string>();
  for (let index = 0; index < 3; index++) runInHistoryBatch(h.batchRef, () => keys.add(h.batchRef.current!));
  assert.equal(keys.size, 3, "every batch has its own key");
  assert.equal(canMergeHistory({ key: "item:A", timestamp: 0 }, { groupKey: "item:A", mode: "merge" }, 1201, 1200), false);
  assert.equal(canMergeHistory({ key: "item:A", timestamp: 0 }, { groupKey: "item:A", mode: "merge" }, 1200, 1200), true);
  assert.deepEqual(withHistoryBatch(null, { groupKey: "x", mode: "merge" }), { groupKey: "x", mode: "merge" });
  assert.deepEqual(withHistoryBatch("history-batch:9", { mode: "skip" }), { mode: "skip" });
});

test("bulk delete of 3 removes all 3 in one undo step; a deleted parent takes its optional children; a lone optional child goes alone", () => {
  const rows = [item("A", 0), item("B", 1), item("C", 2), item("D", 3), item("A-opt", 4, { is_optional: true, parent_item_id: "A", include_in_total: false }), item("D-opt", 5, { is_optional: true, parent_item_id: "D" })];
  const plan = bulkDeletePlan(rows, new Set(["A", "B", "C"]));
  assert.deepEqual(plan.ids, ["A", "B", "C", "A-opt"]);
  assert.equal(plan.question, "Delete 3 rows and 1 optional item?");
  assert.equal(bulkDeletePlan(rows, new Set(["B"])).question, "Delete 1 row?");
  assert.deepEqual(bulkDeletePlan(rows, new Set(["D-opt"])).ids, ["D-opt"], "deleting just a child is fine");
  assert.deepEqual(bulkDeletePlan(rows, new Set(["D", "D-opt"])).ids, ["D", "D-opt"], "a selected child is not counted twice");
  const h = history(workspace(rows));
  runInHistoryBatch(h.batchRef, () => { for (const id of plan.ids) h.removeItem(id); });
  assert.deepEqual(h.state.workspace.items.map((entry) => entry.id), ["D", "D-opt"]);
  assert.equal(h.state.past.length, 1);
  h.undo();
  assert.equal(h.state.workspace.items.length, 6);
});

test("bulk duplicate of 3 adjacent rows: each copy directly below its own source, [A, A', B, B', C, C'], copies are new rows", () => {
  const ws = workspace([item("A", 0), item("B", 1), item("C", 2), item("D", 3)]);
  let counter = 0;
  const next = duplicateRowsBelow(ws, new Set(["A", "B", "C"]), (source) => `${source.id}'${++counter}`, "now");
  assert.deepEqual(order(next), ["A", "A'1", "B", "B'2", "C", "C'3", "D"]);
  const copy = next.items.find((entry) => entry.id === "B'2")!;
  assert.equal(copy.source_item_id, "B");
  assert.deepEqual([copy.unit_price, copy.qty, copy.item_name_snapshot], [100, 2, "B"]);
  assert.equal(ws.items.length, 4, "the input is not mutated");
  assert.deepEqual(order(duplicateRowsBelow(ws, new Set(["B"]), () => "B'", "now")), ["A", "B", "B'", "C", "D"]);
});

test("move to section: keeps relative order, goes to the end, optional children follow their parent, a lone optional child is refused", () => {
  const rows = [item("A", 0), item("A-opt", 1, { is_optional: true, parent_item_id: "A" }), item("B", 2), item("C", 3), item("X", 0, { section_id: "s2" }), item("Y", 1, { section_id: "s2" })];
  const ws = workspace(rows);
  const moved = moveRowsToSectionEnd(ws, ["C", "A"], "s2");
  assert.ok(moved.ok);
  assert.equal(moved.moved, 2);
  assert.deepEqual(order(moved.workspace, "s2"), ["X", "Y", "C", "A", "A-opt"]);
  assert.deepEqual(order(moved.workspace, "s1"), ["B"]);
  assert.equal(moved.workspace.items.find((entry) => entry.id === "A-opt")!.parent_item_id, "A", "the optional relation is kept");
  assert.deepEqual(moveRowsToSectionEnd(ws, ["A-opt"], "s2"), { ok: false, message: "Optional items move with their main row. Select the main row too." });
  assert.deepEqual(moveRowsToSectionEnd(ws, [], "s2"), { ok: false, message: "Select at least one row to move." });
});

test("single-row delete reuses the bulk plan: parent removes its optional children, in ONE undo step, no orphan totals", () => {
  const rows = [item("A", 0), item("A-opt", 1, { is_optional: true, parent_item_id: "A", include_in_total: true }), item("B", 2)];
  const h = history(workspace(rows));
  const before = h.state.workspace.totals.net_total;
  const plan = bulkDeletePlan(h.state.workspace.items, new Set(["A"]));
  assert.deepEqual(plan.ids, ["A", "A-opt"]);
  assert.equal(plan.optionalCount, 1);
  runInHistoryBatch(h.batchRef, () => { for (const id of plan.ids) h.removeItem(id); });
  assert.deepEqual(h.state.workspace.items.map((entry) => entry.id), ["B"]);
  assert.equal(h.state.workspace.totals.net_total, 200, "only B counts; no orphan amount");
  assert.equal(h.state.past.length, 1);
  h.undo();
  assert.deepEqual(h.state.workspace.items.map((entry) => entry.id), ["A", "A-opt", "B"]);
  assert.equal(h.state.workspace.totals.net_total, before);
});

test("single-row delete of an optional child leaves the parent", () => {
  const rows = [item("A", 0), item("A-opt", 1, { is_optional: true, parent_item_id: "A" })];
  const h = history(workspace(rows));
  const plan = bulkDeletePlan(h.state.workspace.items, new Set(["A-opt"]));
  runInHistoryBatch(h.batchRef, () => { for (const id of plan.ids) h.removeItem(id); });
  assert.deepEqual(h.state.workspace.items.map((entry) => entry.id), ["A"]);
});
