import assert from "node:assert/strict";
import test from "node:test";
import { guidedBaseModelSelection } from "./guided-base-model-selection.js";

const groups = [{ id: "executive", pricing_type: "base_model_group" as const, group_name: "Executive", is_active: true, sort_order: 0, items: [{ id: "a" }, { id: "b" }, { id: "c" }], subgroups: [{ id: "standard", subgroup_name: "Standard", sort_order: 0, is_active: true, row_ids: ["a", "b"] }] }, { id: "ceramic", pricing_type: "base_model_group" as const, group_name: "Ceramic", is_active: true, sort_order: 1, items: [{ id: "d" }], subgroups: [{ id: "left", subgroup_name: "Left", sort_order: 0, is_active: true, row_ids: ["d"] }] }];

test("guided selector filters rows by family and subgroup while retaining ungrouped rows", () => {
  assert.deepEqual(guidedBaseModelSelection(groups, "executive", "standard").rows.map((row) => row.id), ["a", "b"]);
  assert.deepEqual(guidedBaseModelSelection(groups, "executive", "__ungrouped__").rows.map((row) => row.id), ["c"]);
  assert.deepEqual(guidedBaseModelSelection(groups, "ceramic", "left").rows.map((row) => row.id), ["d"]);
});

test("a family change cannot retain an invalid subgroup; a single valid configuration resolves safely", () => {
  const selection = guidedBaseModelSelection(groups, "ceramic", "standard");
  assert.equal(selection.resolvedSubgroupId, "left");
  assert.deepEqual(selection.rows.map((row) => row.id), ["d"]);
});
