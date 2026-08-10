import assert from "node:assert/strict";
import test from "node:test";
import {
  addWorkstationPricingRow,
  createWorkstationPricingGroup,
  removeWorkstationPricingGroup,
  removeWorkstationPricingRow,
  replaceWholeTemplateWorkstationRows,
  shouldApplyWorkstationReplacement,
  updateWorkstationPricingGroup,
} from "./workstation-pricing-ui-state.js";

type Row = { id: string; default_price?: number | null };

test("group and row mutations preserve identity and isolate siblings", () => {
  const first = { ...createWorkstationPricingGroup<Row>("group-a", 0, "Standard"), items: [{ id: "row-a" }] };
  const second = { ...createWorkstationPricingGroup<Row>("group-b", 1, "Bench"), items: [{ id: "row-b" }] };

  const added = addWorkstationPricingRow([first, second], "group-a", { id: "row-c" });
  assert.deepEqual(added[0].items.map((row) => row.id), ["row-a", "row-c"]);
  assert.deepEqual(added[1].items.map((row) => row.id), ["row-b"]);

  const removedRow = removeWorkstationPricingRow(added, "group-a", 0);
  assert.deepEqual(removedRow[0].items.map((row) => row.id), ["row-c"]);
  assert.deepEqual(removedRow[1].items.map((row) => row.id), ["row-b"]);

  const renamed = updateWorkstationPricingGroup(removedRow, "group-b", { group_name: "Meeting", is_active: false });
  assert.equal(renamed[1].id, "group-b");
  assert.equal(renamed[1].group_name, "Meeting");
  assert.equal(renamed[1].is_active, false);
  assert.deepEqual(renamed[1].items, [{ id: "row-b" }]);

  assert.deepEqual(removeWorkstationPricingGroup(renamed, "group-a").map((group) => group.id), ["group-b"]);
});

test("empty groups and null, zero, and numeric prices remain distinct", () => {
  const group = createWorkstationPricingGroup<Row>("stable-id", 0);
  assert.deepEqual(group.items, []);
  const withRows = addWorkstationPricingRow(addWorkstationPricingRow(addWorkstationPricingRow([group], group.id,
    { id: "null", default_price: null }), group.id, { id: "zero", default_price: 0 }), group.id,
    { id: "number", default_price: 125.5 });
  assert.deepEqual(withRows[0].items.map((row) => row.default_price), [null, 0, 125.5]);
});

test("whole-template replacement preserves a sole destination and resolves ambiguity to one group", () => {
  const sole = { ...createWorkstationPricingGroup<Row>("current", 0), items: [{ id: "manual" }] };
  assert.equal(replaceWholeTemplateWorkstationRows([sole], [{ id: "imported" }], "unused")[0].id, "current");

  const multiple = [sole, createWorkstationPricingGroup<Row>("other", 1)];
  const replaced = replaceWholeTemplateWorkstationRows(multiple, [{ id: "imported" }], "import-group");
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].id, "import-group");
  assert.deepEqual(replaced[0].items, [{ id: "imported" }]);
});

test("a replacement version applies once so later manual edits remain authoritative", () => {
  assert.equal(shouldApplyWorkstationReplacement(3, undefined), true);
  assert.equal(shouldApplyWorkstationReplacement(3, 3), false);
  assert.equal(shouldApplyWorkstationReplacement(4, 3), true);
  assert.equal(shouldApplyWorkstationReplacement(undefined, 3), false);
});
