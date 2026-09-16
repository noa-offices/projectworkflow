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
  assert.equal(result.draft?.pricing.modularGroups[0].matrix!.rows[0].prices["cat-a"], null);
});

test("optionGroups.conditionalConfiguration preserves a fixed-quantity workstation-targeted required companion (OXI ART.058)", () => {
  const draft = baseDraft();
  draft.pricing.workstationRows.push({ id: "111-623", label: "111 623", price: 1200, supplierCodes: ["111 623"] });
  draft.optionGroups.push({
    id: "art-058", label: "ART.058",
    selection: { mode: "required_choose_one", minSelections: 1, maxSelections: 1, defaultItemIds: [] },
    items: [{ id: "art-058-item", label: "ART.058", price: 69, supplierCodes: ["111 058"] }],
    conditionalConfiguration: {
      role: "companion",
      selection: "exactly_one",
      applicability: [{
        target: { kind: "workstation", group_id: "workstation-rows", row_id: "111-623" },
        required: true,
        visible: true,
        fixed_quantity: 2,
      }],
    },
  });
  const result = normalizeProductTemplateDraft(draft);
  assert.equal(result.valid, true);
  const item = result.draft?.optionGroups[0].items[0];
  assert.equal(item?.price, 69, "Expected the real unit price to be preserved, never a multiplied EUR 138 price");
  const rule = result.draft?.optionGroups[0].conditionalConfiguration?.applicability[0];
  assert.equal(rule?.fixed_quantity, 2);
  assert.equal(rule?.target?.kind, "workstation");
  assert.equal(rule?.target?.row_id, "111-623");
  assert.equal(rule?.required, true);
});

test("optionGroups.conditionalConfiguration preserves exactly-one allowed items targeting exact workstation rows (OXI 111 623/111 624)", () => {
  const draft = baseDraft();
  draft.optionGroups.push({
    id: "leg-choice", label: "Required Leg",
    selection: { mode: "required_choose_one", minSelections: 1, maxSelections: 1, defaultItemIds: [] },
    items: [
      { id: "art-175", label: "ART.175", price: 45, supplierCodes: ["ART.175"] },
      { id: "art-129", label: "ART.129", price: 52, supplierCodes: ["ART.129"] },
    ],
    conditionalConfiguration: {
      role: "companion",
      selection: "exactly_one",
      applicability: [
        { target: { kind: "workstation", group_id: "workstation-rows", row_id: "111-623" }, required: true, visible: true, allowed_item_ids: ["art-175", "art-129"] },
        { target: { kind: "workstation", group_id: "workstation-rows", row_id: "111-624" }, required: true, visible: true, allowed_item_ids: ["art-175", "art-129"] },
      ],
    },
  });
  const result = normalizeProductTemplateDraft(draft);
  assert.equal(result.valid, true);
  const applicability = result.draft?.optionGroups[0].conditionalConfiguration?.applicability ?? [];
  assert.equal(applicability.length, 2);
  assert.deepEqual(applicability.map((rule) => rule.target?.row_id).sort(), ["111-623", "111-624"]);
  applicability.forEach((rule) => assert.deepEqual(rule.allowed_item_ids, ["art-175", "art-129"]));
});

test("conditionalConfiguration rejects an unknown target kind, an unknown allowed item id, and a non-positive fixed quantity", () => {
  const unknownKind = baseDraft();
  unknownKind.optionGroups.push({
    id: "g1", label: "G1", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: [] },
    items: [{ id: "i1", label: "I1", price: 10 }],
    conditionalConfiguration: { role: "companion", selection: "exactly_one", applicability: [{ target: { kind: "bogus_kind", group_id: "g", row_id: "r" }, required: true, visible: true }] },
  });
  assert.equal(normalizeProductTemplateDraft(unknownKind).valid, false);

  const unknownItem = baseDraft();
  unknownItem.optionGroups.push({
    id: "g2", label: "G2", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: [] },
    items: [{ id: "i1", label: "I1", price: 10 }],
    conditionalConfiguration: { role: "companion", selection: "exactly_one", applicability: [{ target: { kind: "workstation", group_id: "g", row_id: "r" }, required: true, visible: true, allowed_item_ids: ["does-not-exist"] }] },
  });
  assert.equal(normalizeProductTemplateDraft(unknownItem).valid, false);

  const badQuantity = baseDraft();
  badQuantity.optionGroups.push({
    id: "g3", label: "G3", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: [] },
    items: [{ id: "i1", label: "I1", price: 10 }],
    conditionalConfiguration: { role: "companion", selection: "exactly_one", applicability: [{ target: { kind: "workstation", group_id: "g", row_id: "r" }, required: true, visible: true, fixed_quantity: 0 }] },
  });
  assert.equal(normalizeProductTemplateDraft(badQuantity).valid, false);
});

test("ordinary option groups may omit conditionalConfiguration entirely", () => {
  const draft = baseDraft();
  draft.optionGroups.push({
    id: "cushion", label: "Cushion", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] },
    items: [{ id: "cushion-a", label: "Cushion A", price: 20 }],
  });
  const result = normalizeProductTemplateDraft(draft);
  assert.equal(result.valid, true);
  assert.equal(result.draft?.optionGroups[0].conditionalConfiguration, undefined);
});

test("confidence accepts the documented zero-through-one range", () => {
  [0, 0.8, 0.95, 1].forEach((confidence) => {
    const draft = baseDraft(); draft.confidence = confidence;
    assert.equal(normalizeProductTemplateDraft(draft).valid, true);
  });
  const draft = baseDraft(); draft.confidence = 95;
  assert.equal(normalizeProductTemplateDraft(draft).valid, false);
});

test("conditionalConfiguration preserves modular quantity scaling and rejects unsupported scaling", () => {
  const draft = baseDraft();
  draft.optionGroups.push({ id: "art-058", label: "ART.058", selection: { mode: "choose_multiple", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [{ id: "058", label: "ART.058", price: 69 }], conditionalConfiguration: { role: "companion", selection: "choose_multiple", applicability: [{ target: { kind: "modular", group_id: "oxi", row_id: "starter" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true }] } });
  const valid = normalizeProductTemplateDraft(draft);
  assert.equal(valid.valid, true);
  assert.equal(valid.draft?.optionGroups[0].conditionalConfiguration?.applicability[0].scale_with_target_quantity, true);
  const configuration = draft.optionGroups[0].conditionalConfiguration as { selection: string; applicability: Array<{ target: { kind: "base_model" | "modular"; group_id: string; row_id: string } }> };
  configuration.applicability[0].target = { kind: "base_model", group_id: "base", row_id: "row" };
  assert.equal(normalizeProductTemplateDraft(draft).valid, false);
  configuration.applicability[0].target = { kind: "modular", group_id: "oxi", row_id: "starter" };
  configuration.selection = "exactly_one";
  assert.equal(normalizeProductTemplateDraft(draft).valid, false);
});
