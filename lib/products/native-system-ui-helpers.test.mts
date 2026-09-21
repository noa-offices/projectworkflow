import assert from "node:assert/strict";
import test from "node:test";
import { nativeSystemGroupSummary, removeRowFromReviewSubgroups, splitNativeGroupRows } from "./base-model-draft-groups.js";
import { normalizeProductTemplateDraft, type ProductTemplateDraft } from "./product-template-draft.js";
import { productTemplateFormSmartWorkspace } from "./product-template-form-smart-workspace.js";
import { deriveProductFamilyLabel, deriveVisualSubgroupFamilyLabel, inferBaseModelVisualSubgroups, inferNativeMainProductFamilies } from "./smart-product-base-model-auto-subgroups.js";
import { createSmartSetupReviewRouting } from "./smart-product-review-routing.js";
import { canonicalSubgroupsForSmartSetupApply } from "./smart-product-row-images.js";
import { assignVisualSubgroupRows } from "./smart-product-subgroup-presentation.js";

const row = (id: string, displayName: string, role?: "system_base") => ({ id, label: null, displayName, ...(role ? { role } : {}) });
const names = (subgroups: Array<{ subgroup_name: string }>) => subgroups.map((subgroup) => subgroup.subgroup_name);

// ---- auto-subgroup at product-family level ----
const sizes = [["D70", "W120"], ["D70", "W140"], ["D80", "W160"], ["D80", "W180"]];
const benchSizes = [["D145.2", "W120"], ["D145.2", "W180"], ["D165.2", "W120"], ["D165.2", "W180"]];
// Labels put dimensions in the MIDDLE: "<Type> <depth> <width> <SERIES> for <system> - <top>".
const fixture = (system: string, entries: Array<{ type: string; series: string; top: string; grid: string[][] }>) =>
  entries.flatMap((entry, entryIndex) => entry.grid.map(([depth, width], index) => row(`${entryIndex}-${index}`, `${entry.type} ${depth} ${width} ${entry.series} for ${system} - ${entry.top}`)));
const plainTop = (type: string) => (type === "Bench" ? "Plain Tops" : "Plain Top");
const combyFixture = fixture("Comby", ["SIGMA_Q", "SIGMA_L"].flatMap((series) => ["Desk", "Bench"].flatMap((type) => [plainTop(type), "With Top-Access"].map((top) => ({ type, series, top, grid: type === "Bench" ? benchSizes : sizes })))));
const p58Fixture = fixture("Service Cabinet P58", ["SIGMA_Q", "SIGMA_L"].flatMap((series) => ["Plain Top", "With Top-Access"].map((top) => ({ type: "Desk", series, top, grid: sizes }))));

test("1-2: Q Desk D70/D80 x W120-W180 collapse into one family; Top Access is a separate family", () => {
  assert.equal(deriveProductFamilyLabel("Desk D70 W120 SIGMA_Q for Comby - Plain Top"), "SIGMA_Q Desk");
  assert.equal(deriveProductFamilyLabel("Desk D80 W180 SIGMA_Q for Comby - Plain Top"), "SIGMA_Q Desk");
  assert.equal(deriveProductFamilyLabel("Desk D70 W120 SIGMA_Q for Comby - With Top-Access"), "SIGMA_Q Desk + Top Access");
  assert.equal(deriveProductFamilyLabel("Desk D 80 W 180 SIGMA_Q for Comby - with top access"), "SIGMA_Q Desk + Top Access");
});

test("3-4: Q Bench D145.2/D165.2 collapse into one family; Bench Top Access is separate", () => {
  assert.equal(deriveProductFamilyLabel("Bench D145.2 W120 SIGMA_Q for Comby - Plain Tops"), "SIGMA_Q Bench");
  assert.equal(deriveProductFamilyLabel("Bench D165,2 W180 SIGMA_Q for Comby - Plain Tops"), "SIGMA_Q Bench");
  assert.equal(deriveProductFamilyLabel("Bench D145.2 W120 SIGMA_Q for Comby - With Top-Access"), "SIGMA_Q Bench + Top Access");
});

test("5-6: SIGMA_Q vs SIGMA_L and Desk vs Bench stay separate", () => {
  assert.notEqual(deriveProductFamilyLabel("Desk D70 W120 SIGMA_Q for Comby - Plain Top"), deriveProductFamilyLabel("Desk D70 W120 SIGMA_L for Comby - Plain Top"));
  assert.notEqual(deriveProductFamilyLabel("Desk D70 W120 SIGMA_Q for Comby - Plain Top"), deriveProductFamilyLabel("Bench D70 W120 SIGMA_Q for Comby - Plain Top"));
});

test("COMBY-style fixture: 8 Main Product families and no rows left in Other models", () => {
  const families = inferNativeMainProductFamilies(combyFixture);
  assert.equal(families.length, 8);
  assert.deepEqual(names(families).toSorted(), ["SIGMA_L Bench", "SIGMA_L Bench + Top Access", "SIGMA_L Desk", "SIGMA_L Desk + Top Access", "SIGMA_Q Bench", "SIGMA_Q Bench + Top Access", "SIGMA_Q Desk", "SIGMA_Q Desk + Top Access"]);
  assert.equal(families.flatMap((family) => family.row_ids).length, combyFixture.length);
  assert.ok(families.every((family) => family.row_ids.length === 4));
});

test("7: P58-style fixture: 4 Main Product families by commercial family and no rows left in Other models", () => {
  const families = inferNativeMainProductFamilies(p58Fixture);
  assert.deepEqual(names(families).toSorted(), ["SIGMA_L Desk", "SIGMA_L Desk + Top Access", "SIGMA_Q Desk", "SIGMA_Q Desk + Top Access"]);
  assert.equal(families.flatMap((family) => family.row_ids).length, p58Fixture.length);
});

test("6: system_base rows never auto-group", () => {
  const rows = [row("sys", "COMBY Single-Side Base - W 80", "system_base"), row("sys2", "COMBY Single-Side Base - W 100", "system_base"), row("m1", "Sigma_Q Desk - W140 D70"), row("m2", "Sigma_Q Desk - W140 D80")];
  const families = inferNativeMainProductFamilies(rows);
  assert.deepEqual(families.map((family) => family.row_ids), [["m1", "m2"]]);
});

test("7: ordinary (non-native) auto-subgroup behavior is unchanged", () => {
  const rows = ["W 140 D 70", "W 140 D 80", "W 160 D 70", "W 160 D 80"].map((size, index) => row(`o${index}`, `Desk for P58 - ${size}`));
  // legacy rule strips only a trailing number, so each width stays its own subgroup (W 140 D / W 160 D)
  assert.equal(inferBaseModelVisualSubgroups(rows).length, 2);
  assert.equal(inferNativeMainProductFamilies(rows).length, 1);
  assert.equal(deriveVisualSubgroupFamilyLabel("Desk Top Access - 120"), "Desk Top Access");
});

test("8: reopening a saved native group keeps the reviewed subgroups instead of re-inferring", () => {
  const saved = { id: "custom-family", subgroup_name: "My family", sort_order: 0, is_active: true, row_ids: ["a"] };
  const workspace = productTemplateFormSmartWorkspace({
    variant_pricing: JSON.stringify([{ id: "system-a", pricing_type: "base_model_group", group_name: "System A", is_active: true, sort_order: 0, subgroups: [saved], items: [{ id: "a", variant_name: "Desk - W140 D70", price: 1 }, { id: "b", variant_name: "Desk - W140 D80", price: 1 }] }]),
    desking_size_pricing: "[]", category_pricing: "[]", modular_item_pricing: "[]", accessory_pricing: "[]",
  });
  assert.deepEqual(workspace.subgroups["base_model_group:system-a"], [saved]);
});

// ---- counts / panel helpers ----
const groupRows = [
  { id: "sys", role: "system_base" as const },
  { id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" },
];
const subgroups = [
  { id: "f1", is_active: true, row_ids: ["m1", "m2"] },
  { id: "f2", is_active: true, row_ids: ["m3"] },
  { id: "f3", is_active: true, row_ids: [] },
];

test("9-11: summary counts system rows separately, excludes them from Main models, and counts families with models", () => {
  assert.deepEqual(nativeSystemGroupSummary(groupRows, subgroups), { systemCount: 1, mainCount: 4, familyCount: 2 });
  assert.equal(nativeSystemGroupSummary(groupRows, [{ id: "x", is_active: true, row_ids: ["sys"] }]).familyCount, 0);
});

test("12-14: System panel receives only system rows; role manager sees all rows; Edit models candidates exclude system rows", () => {
  const { systemRows, mainRows } = splitNativeGroupRows(groupRows);
  assert.deepEqual(systemRows.map((entry) => entry.id), ["sys"]);
  assert.deepEqual(mainRows.map((entry) => entry.id), ["m1", "m2", "m3", "m4"]);
  assert.equal(groupRows.length, 5); // the role manager lists every row
});

test("15: changing a row to System / Base removes only its subgroup membership", () => {
  const next = removeRowFromReviewSubgroups(subgroups, "m1");
  assert.deepEqual(next.map((entry) => entry.row_ids), [["m2"], ["m3"], []]);
  assert.deepEqual(next.map((entry) => entry.id), ["f1", "f2", "f3"]);
});

// ---- regression ----
test("16: manual reassignment still moves rows between families", () => {
  const rows = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
  const before = [{ id: "f1", subgroup_name: "A", sort_order: 0, is_active: true, row_ids: ["m1", "m2"] }, { id: "f2", subgroup_name: "B", sort_order: 1, is_active: true, row_ids: ["m3"] }];
  const after = assignVisualSubgroupRows(rows, before, "f2", new Set(["m2", "m3"]));
  assert.deepEqual(after.map((entry) => entry.row_ids), [["m1"], ["m2", "m3"]]);
});

test("17: Apply keeps subgroup ids/row ids and drops system rows", () => {
  const result = normalizeProductTemplateDraft({
    version: 1, template: { templateName: "T" }, defaultCurrency: "AED",
    pricing: { workstationRows: [], baseModelRows: [
      { id: "sys", groupId: "g", groupLabel: "G", role: "system_base", displayName: "Base", supplierCodes: [], referenceCodes: [] },
      { id: "m1", groupId: "g", displayName: "Desk - W140 D70", supplierCodes: [], referenceCodes: [] },
      { id: "m2", groupId: "g", displayName: "Desk - W140 D80", supplierCodes: [], referenceCodes: [] },
    ], priceMatrices: [], modularGroups: [] },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 1, sources: [],
  });
  const draft = result.draft as ProductTemplateDraft;
  const plan = createSmartSetupReviewRouting(draft);
  const applied = canonicalSubgroupsForSmartSetupApply(draft, plan, { "base_model_group:g": [{ id: "auto-desk", subgroup_name: "Desk", sort_order: 0, is_active: true, row_ids: ["sys", "m1", "m2"] }] });
  assert.equal(applied[0].subgroups[0].id, "auto-desk");
  assert.deepEqual(applied[0].subgroups[0].row_ids, ["m1", "m2"]);
});

test("18-19: legacy flat Base/Model reopen and non-base-model routes are untouched by native family inference", () => {
  const workspace = productTemplateFormSmartWorkspace({
    variant_pricing: JSON.stringify([{ id: "legacy", variant_name: "Legacy - 120", price: 1 }]),
    desking_size_pricing: "[]", category_pricing: "[]", modular_item_pricing: "[]", accessory_pricing: "[]",
  });
  assert.deepEqual(Object.keys(workspace.subgroups), []);
  assert.equal(workspace.plan.routes[0].key, "base_model:rows");
});
