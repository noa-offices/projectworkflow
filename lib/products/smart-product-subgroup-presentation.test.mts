import assert from "node:assert/strict";
import test from "node:test";
import { assignVisualSubgroupRows, visualSubgroupRowSections } from "./smart-product-subgroup-presentation.js";

const rows = ["EV111", "EV112", "EV114", "EV711", "EV116"].map((id) => ({ id }));

test("visual subgroup presentation preserves source rows without duplication", () => {
  const sections = visualSubgroupRowSections(rows, [
    { id: "standard", subgroup_name: "Standard Seat", row_ids: ["EV111", "EV112", "EV114"] },
    { id: "comfort", subgroup_name: "Comfort Seat", row_ids: ["EV711"] },
  ]);
  assert.deepEqual(sections.map((section) => [section.subgroup?.subgroup_name ?? "Ungrouped", section.rows.map((row) => row.id)]), [
    ["Standard Seat", ["EV111", "EV112", "EV114"]],
    ["Comfort Seat", ["EV711"]],
    ["Ungrouped", ["EV116"]],
  ]);
  assert.deepEqual(sections.flatMap((section) => section.rows), rows);
});

test("visual subgroup presentation retains the flat list when no subgroups exist", () => {
  const sections = visualSubgroupRowSections(rows, []);
  assert.deepEqual(sections, [{ subgroup: null, rows }]);
});

test("removing a subgroup immediately returns its rows to ungrouped", () => {
  const sections = visualSubgroupRowSections(rows, [{ id: "standard", subgroup_name: "Standard Seat", row_ids: ["EV111"] }]);
  assert.deepEqual(sections[1].rows.map((row) => row.id), ["EV112", "EV114", "EV711", "EV116"]);
});

test("checklist assignment moves selected rows and clears unchecked active rows", () => {
  const assigned = assignVisualSubgroupRows(rows, [
    { id: "standard", subgroup_name: "Standard Seat", row_ids: ["EV111", "EV112"] },
    { id: "comfort", subgroup_name: "Comfort Seat", row_ids: ["EV116"] },
  ], "standard", new Set(["EV111", "EV116"]));
  assert.deepEqual(assigned.map((subgroup) => subgroup.row_ids), [["EV111", "EV116"], []]);
});
