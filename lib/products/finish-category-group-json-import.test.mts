import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft } from "./product-template-draft.js";
import { getFinishCategoryGroupImportCandidates, replaceFinishCategoryGroup } from "./finish-category-group-json-import.js";

function draft(priceMatrices: ProductTemplateDraft["pricing"]["priceMatrices"]): ProductTemplateDraft {
  return {
    version: 1,
    template: { templateName: null, templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: "EUR",
    pricing: { workstationRows: [], baseModelRows: [], priceMatrices, modularGroups: [] },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
  };
}

function matrix(id: string, label: string) {
  return { id, label, columns: [{ id: "com-s", label: "COM / S" }, { id: "t", label: "T" }, { id: "m", label: "M" }], rows: [{ id: `${id}-seat`, label: "Seat", displayName: "Seat", dimensions: null, currency: "EUR" as const, specification: null, supplierCodes: ["S-01"], referenceCodes: [], prices: { "com-s": null, t: 0, m: 125 } }] };
}

test("one compatible matrix preserves source order and price values", () => {
  const result = getFinishCategoryGroupImportCandidates(draft([matrix("arca", "ARCA Lounge Upholstery Pricing")]));
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].group.price_categories, ["COM / S", "T", "M"]);
  assert.equal(result.candidates[0].group.items[0].prices?.["COM / S"], null);
  assert.equal(result.candidates[0].group.items[0].prices?.T, 0);
  assert.equal(result.candidates[0].group.items[0].prices?.M, 125);
});

test("multiple candidates require selection and modular matrices are rejected", () => {
  assert.equal(getFinishCategoryGroupImportCandidates(draft([matrix("lounge", "Lounge"), matrix("small", "Small")])).candidates.length, 2);
  const modular = getFinishCategoryGroupImportCandidates(draft([matrix("modular", "Modular Seating")]));
  assert.equal(modular.candidates.length, 0);
  assert.ok(modular.warnings.some((warning) => warning.includes("Modular")));
});

test("only the selected target group is replaced and keeps local identity", () => {
  const groups = [{ id: "group-a", group_name: "Group A", is_active: false, sort_order: 0 }, { id: "group-b", group_name: "Group B", is_active: true, sort_order: 1 }];
  const replacement = { id: "source-arca", group_name: "ARCA Lounge", is_active: true, sort_order: 9 };
  const next = replaceFinishCategoryGroup(groups, "group-b", replacement);
  assert.equal(next[0], groups[0]);
  assert.deepEqual(next[1], { id: "group-b", group_name: "ARCA Lounge", is_active: true, sort_order: 1 });
  assert.deepEqual(replaceFinishCategoryGroup(groups, "missing", replacement), groups);
});
