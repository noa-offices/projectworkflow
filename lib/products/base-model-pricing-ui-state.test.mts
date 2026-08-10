import assert from "node:assert/strict";
import test from "node:test";
import {
  addBaseModelPricingRow,
  createBaseModelPricingGroup,
  removeBaseModelPricingGroup,
  removeBaseModelPricingRow,
  replaceWholeTemplateBaseModelRows,
  shouldApplyBaseModelReplacement,
  updateBaseModelPricingGroup,
} from "./base-model-pricing-ui-state.js";

type Row = { id: string; price?: number | null };

test("group and row mutations preserve identity and isolate siblings", () => {
  const first = { ...createBaseModelPricingGroup<Row>("group-a", 0, "Executive"), items: [{ id: "row-a" }] };
  const second = { ...createBaseModelPricingGroup<Row>("group-b", 1, "Meeting"), items: [{ id: "row-b" }] };
  const added = addBaseModelPricingRow([first, second], "group-a", { id: "row-c" });
  assert.deepEqual(added[0].items.map((item) => item.id), ["row-a", "row-c"]);
  assert.deepEqual(added[1].items.map((item) => item.id), ["row-b"]);
  const removed = removeBaseModelPricingRow(added, "group-a", 0);
  assert.deepEqual(removed[0].items.map((item) => item.id), ["row-c"]);
  assert.deepEqual(removed[1].items.map((item) => item.id), ["row-b"]);
  const renamed = updateBaseModelPricingGroup(removed, "group-b", { group_name: "Conference", is_active: false });
  assert.equal(renamed[1].id, "group-b");
  assert.deepEqual(renamed[1].items, [{ id: "row-b" }]);
  assert.equal(renamed[1].is_active, false);
  assert.deepEqual(removeBaseModelPricingGroup(renamed, "group-a").map((entry) => entry.id), ["group-b"]);
});

test("new group IDs remain stable and empty groups preserve null, zero, and exact prices", () => {
  const group = createBaseModelPricingGroup<Row>("stable-id", 0);
  const populated = addBaseModelPricingRow(addBaseModelPricingRow(addBaseModelPricingRow([group], group.id, { id: "null", price: null }), group.id, { id: "zero", price: 0 }), group.id, { id: "exact", price: 99.5 });
  assert.equal(group.id, "stable-id");
  assert.deepEqual(createBaseModelPricingGroup<Row>("empty", 1).items, []);
  assert.deepEqual(populated[0].items.map((item) => item.price), [null, 0, 99.5]);
});

test("whole-template replacement preserves a sole destination and resolves ambiguity to one group", () => {
  const sole = { ...createBaseModelPricingGroup<Row>("current", 0), items: [{ id: "manual" }] };
  assert.equal(replaceWholeTemplateBaseModelRows([sole], [{ id: "imported" }], "unused")[0].id, "current");
  const replaced = replaceWholeTemplateBaseModelRows([sole, createBaseModelPricingGroup<Row>("other", 1)], [{ id: "imported" }], "import-group");
  assert.deepEqual(replaced.map((entry) => entry.id), ["import-group"]);
  assert.deepEqual(replaced[0].items, [{ id: "imported" }]);
});

test("replacement versions apply once so manual edits remain authoritative", () => {
  assert.equal(shouldApplyBaseModelReplacement(1, undefined), true);
  assert.equal(shouldApplyBaseModelReplacement(1, 1), false);
  assert.equal(shouldApplyBaseModelReplacement(2, 1), true);
  assert.equal(shouldApplyBaseModelReplacement(undefined, 1), false);
});
