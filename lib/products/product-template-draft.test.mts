import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductTemplateDraft } from "./product-template-draft.js";

type DraftInput = {
  version: number;
  template: Record<string, unknown>;
  defaultCurrency: string;
  pricing: {
    workstationRows: Record<string, unknown>[];
    baseModelRows: Record<string, unknown>[];
    priceMatrices: Record<string, unknown>[];
    modularGroups: Record<string, unknown>[];
  };
  optionGroups: Record<string, unknown>[];
  materialSuggestions: Record<string, unknown>[];
  linkedFamilySuggestions: Record<string, unknown>[];
  extractionWarnings: string[];
  confidence: number;
  sources: Record<string, unknown>[];
};

function baseDraft(): DraftInput {
  return {
    version: 1,
    template: { templateName: "Example" },
    defaultCurrency: "AED",
    pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 0.8, sources: [],
  };
}

function matrix(id = "upholstery") {
  return {
    id, label: "Upholstery", columns: [{ id: "cat-a", label: "Cat A" }],
    rows: [{ id: "chair", label: "Chair", prices: { "cat-a": null } }],
  };
}

test("price semantics preserve zero and normalize an empty price to null", () => {
  const draft = baseDraft();
  draft.pricing.baseModelRows.push({ id: "free", label: "Free", price: 0, supplierCodes: ["L", "R", "L"] });
  draft.pricing.baseModelRows.push({ id: "unknown", label: "Unknown", price: "" });
  draft.pricing.baseModelRows.push({ id: "explicit-null", label: "Explicit null", price: null });
  const result = normalizeProductTemplateDraft(draft);
  assert.equal(result.valid, true);
  assert.equal(result.draft?.pricing.baseModelRows[0].price, 0);
  assert.equal(result.draft?.pricing.baseModelRows[1].price, null);
  assert.equal(result.draft?.pricing.baseModelRows[2].price, null);
  assert.deepEqual(result.draft?.pricing.baseModelRows[0].supplierCodes, ["L", "R"]);
});

test("important requirements remain separate, ordered, trimmed, and deduplicated", () => {
  const draft = baseDraft();
  draft.pricing.baseModelRows.push({ id: "cabinet", label: "Cabinet", price: 100, specification: "Open high cabinet.", importantRequirements: [" Finishing top required ", "", "Wall fixing required", "Finishing top required", 42] });
  const result = normalizeProductTemplateDraft(draft);
  assert.equal(result.valid, true);
  assert.equal(result.draft?.pricing.baseModelRows[0].specification, "Open high cabinet.");
  assert.deepEqual(result.draft?.pricing.baseModelRows[0].importantRequirements, ["Finishing top required", "Wall fixing required"]);
});

test("unsupported versions, malformed prices, and duplicate matrix ids are rejected", () => {
  const version = baseDraft();
  version.version = 2;
  assert.equal(normalizeProductTemplateDraft(version).valid, false);
  const duplicate = baseDraft();
  duplicate.pricing.priceMatrices = [{
    ...matrix(),
    columns: [{ id: "cat", label: "A" }, { id: "cat", label: "B" }],
    rows: [
      { id: "same", label: "One", prices: { cat: null } },
      { id: "same", label: "Two", prices: { cat: null } },
    ],
  }];
  assert.equal(normalizeProductTemplateDraft(duplicate).valid, false);
  const invalidPrice = baseDraft();
  invalidPrice.pricing.baseModelRows.push({ id: "bad", price: "not-a-number" });
  assert.equal(normalizeProductTemplateDraft(invalidPrice).valid, false);
});

test("selection rules require valid ranges and valid default targets", () => {
  const draft = baseDraft();
  draft.optionGroups.push({
    id: "arms", label: "Arms",
    selection: { mode: "required_choose_one", minSelections: 2, maxSelections: 1, defaultItemIds: ["missing"] },
    items: [{ id: "arm-a", label: "Arm A", price: null }],
  });
  assert.equal(normalizeProductTemplateDraft(draft).valid, false);
});

test("valid workstation, upholstery matrix, modular group, and option group drafts pass", () => {
  const draft = baseDraft();
  draft.pricing.workstationRows.push({
    id: "desk-140", label: "140 desk", price: 0, additionalPrice: null, layoutType: "linear",
    dimensions: { width: 140, depth: 70, height: 75, unit: "cm", rawText: "140 x 70 x 75 cm" },
    supplierCodes: ["BASE-140", "TOP-140"],
  });
  draft.pricing.priceMatrices.push(matrix());
  draft.pricing.modularGroups.push({ id: "drive-in", label: "Drive In", defaultDimensions: null, defaultSpecification: null, matrix: matrix("drive-in-matrix") });
  draft.optionGroups.push({
    id: "power", label: "Power", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: ["power-a"] },
    items: [{ id: "power-a", label: "Power socket", price: null }],
  });
  const result = normalizeProductTemplateDraft(draft);
  assert.equal(result.valid, true);
  assert.equal(result.draft?.pricing.workstationRows[0].dimensions?.width, 140);
  assert.equal(result.draft?.pricing.modularGroups[0].matrix.rows[0].prices["cat-a"], null);
});
