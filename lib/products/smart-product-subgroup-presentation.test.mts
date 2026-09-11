import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("unknown assignments and empty subgroups cannot hide or duplicate valid pricing rows", () => {
  const sections = visualSubgroupRowSections(rows, [
    { id: "empty", subgroup_name: "Empty", row_ids: ["UNKNOWN"] },
    { id: "sofas", subgroup_name: "Sofas", row_ids: ["EV111", "UNKNOWN", "EV111"] },
    { id: "duplicate", subgroup_name: "Duplicate", row_ids: ["EV111", "EV112"] },
  ]);
  assert.deepEqual(sections.map((section) => [section.subgroup?.subgroup_name ?? "Ungrouped", section.rows.map((row) => row.id)]), [
    ["Empty", []],
    ["Sofas", ["EV111"]],
    ["Duplicate", ["EV112"]],
    ["Ungrouped", ["EV114", "EV711", "EV116"]],
  ]);
  assert.deepEqual(sections.filter((section) => section.rows.length).flatMap((section) => section.rows), rows);
});

test("subgroup projection preserves subgroup array order, source row order, columns, and prices", () => {
  const matrixRows = [
    { id: "sofa-2", prices: { fabric: 220, leather: 320 } },
    { id: "side-1", prices: { fabric: 120, leather: 180 } },
    { id: "sofa-1", prices: { fabric: 200, leather: 300 } },
  ];
  const columns = [{ id: "fabric" }, { id: "leather" }];
  const sections = visualSubgroupRowSections(matrixRows, [
    { id: "sides", subgroup_name: "Side Elements", row_ids: ["side-1"] },
    { id: "sofas", subgroup_name: "Sofas", row_ids: ["sofa-1", "sofa-2"] },
  ]);
  assert.deepEqual(sections.map((section) => section.subgroup?.id), ["sides", "sofas"]);
  assert.deepEqual(sections[1].rows.map((row) => row.id), ["sofa-2", "sofa-1"]);
  assert.equal(sections[0].rows[0], matrixRows[1]);
  assert.deepEqual(columns, [{ id: "fabric" }, { id: "leather" }]);
  assert.deepEqual(matrixRows.map((row) => row.prices), [{ fabric: 220, leather: 320 }, { fabric: 120, leather: 180 }, { fabric: 200, leather: 300 }]);
});

test("grouped cards are wired across every supported Smart Setup pricing destination", () => {
  const source = readFileSync("components/products/smart-product-json-import.tsx", "utf8");
  const workstationSection = source.slice(source.indexOf('{draft.pricing.workstationRows.length'), source.indexOf('{draft.pricing.baseModelRows.length'));
  const baseModelSection = source.slice(source.indexOf('{draft.pricing.baseModelRows.length'), source.indexOf('{draft.pricing.priceMatrices.length'));
  const categorySection = source.slice(source.indexOf('{draft.pricing.priceMatrices.length'), source.indexOf('{draft.pricing.modularGroups.length'));
  const modularSection = source.slice(source.indexOf('{draft.pricing.modularGroups.length'), source.indexOf('{draft.optionGroups.length'));
  const accessorySection = source.slice(source.indexOf('{draft.optionGroups.length'), source.indexOf('{draft.materialSuggestions.length'));
  assert.ok(workstationSection.includes("<PricedRowsEditor workstation subgroups="));
  assert.ok(baseModelSection.includes("<PricedRowsEditor compact dense subgroups="));
  assert.ok(categorySection.includes("<MatrixEditor groupedSubgroupCards"));
  assert.ok(modularSection.includes("<MatrixEditor groupedSubgroupCards"));
  assert.ok(modularSection.includes("subgroups={route ? subgroups?.[route.key] : undefined}"));
  assert.ok(accessorySection.includes("<PricedRowsEditor compact subgroups="));
  assert.ok(accessorySection.includes("Extracted selection rule:"));
  assert.ok(accessorySection.includes("findingsForRow="));
  assert.ok(source.includes("visualSubgroupRowSections(rows, subgroups).filter((section) => section.rows.length)"));
  assert.ok(source.includes('section.subgroup?.id ?? "__ungrouped__"'));
  assert.ok(source.includes('section.subgroup?.subgroup_name ?? "Ungrouped"'));
});

test("presentation projection preserves destination-specific row data by reference", () => {
  const destinationRows = [
    { id: "base", price: 100, currency: "AED" },
    { id: "workstation", price: 200, additionalPrice: 25, layoutType: "cluster", currency: "USD" },
    { id: "accessory", price: 30, specification: "Cable management" },
  ];
  const sections = visualSubgroupRowSections(destinationRows, [
    { id: "primary", subgroup_name: "Primary", row_ids: ["workstation", "base"] },
  ]);
  assert.deepEqual(sections.map((section) => section.rows.map((row) => row.id)), [["base", "workstation"], ["accessory"]]);
  assert.equal(sections[0].rows[0], destinationRows[0]);
  assert.equal(sections[0].rows[1], destinationRows[1]);
  assert.equal(sections[1].rows[0], destinationRows[2]);
  assert.deepEqual(destinationRows, [
    { id: "base", price: 100, currency: "AED" },
    { id: "workstation", price: 200, additionalPrice: 25, layoutType: "cluster", currency: "USD" },
    { id: "accessory", price: 30, specification: "Cable management" },
  ]);
});
