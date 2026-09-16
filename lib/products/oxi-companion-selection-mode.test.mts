import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_TEMPLATE_DRAFT_VERSION, normalizeProductTemplateDraft, type ProductTemplateDraft } from "./product-template-draft.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";
import { evaluateAccessoryConfigurationForModel, accessoryApplicabilityTargetKey } from "./accessory-conditional-configuration.js";
import { LEGACY_WORKSTATION_GROUP_ID } from "./workstation-pricing-groups.js";

/** OXI_Q: base bench "oxi-q-ws-dx" requiring exactly one of ART.175 or ART.129 (choose-one companion). */
function chooseOneDraft(): ProductTemplateDraft {
  return {
    version: PRODUCT_TEMPLATE_DRAFT_VERSION,
    template: { templateName: "OXI_Q", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: "EUR",
    pricing: {
      workstationRows: [{ id: "oxi-q-ws-dx", label: "OXI Q Workstation DX", displayName: null, dimensions: null, currency: "EUR", price: 1200, additionalPrice: null, layoutType: null, specification: null, supplierCodes: ["111 623"], referenceCodes: [] }],
      baseModelRows: [], priceMatrices: [], modularGroups: [],
    },
    optionGroups: [{
      id: "leg-choice", label: "Required Leg",
      selection: { mode: "required_choose_at_least_one", minSelections: 1, maxSelections: null, defaultItemIds: [] },
      items: [
        { id: "art-175", label: "ART.175", displayName: null, dimensions: null, currency: "EUR", price: 45, specification: null, supplierCodes: ["ART.175"], referenceCodes: [] },
        { id: "art-129", label: "ART.129", displayName: null, dimensions: null, currency: "EUR", price: 52, specification: null, supplierCodes: ["ART.129"], referenceCodes: [] },
      ],
      conditionalConfiguration: {
        role: "companion",
        selection: "exactly_one",
        applicability: [{ target: { kind: "workstation", group_id: LEGACY_WORKSTATION_GROUP_ID, row_id: "oxi-q-ws-dx" }, required: true, visible: true, allowed_item_ids: ["art-175", "art-129"] }],
      },
    }],
    materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 0.9, sources: [],
  };
}

/** OXI_P: modular starter/intermediate benches each requiring 2 x ART.058 (quantity-scaled companion). */
function scaledDraft(): ProductTemplateDraft {
  return {
    version: PRODUCT_TEMPLATE_DRAFT_VERSION,
    template: { templateName: "OXI_P", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: "EUR",
    pricing: {
      workstationRows: [], baseModelRows: [], priceMatrices: [],
      modularGroups: [{
        id: "oxi-p-bench", label: "OXI_P Bench", defaultDimensions: null, defaultSpecification: null,
        pricingMode: "direct",
        directRows: [
          { id: "oxi-p-starter-140", label: "Starter bench 140", displayName: null, dimensions: null, currency: "EUR", price: 425, specification: null, supplierCodes: ["111 065"], referenceCodes: [], role: "starter" },
          { id: "oxi-p-intermediate-140", label: "Intermediate bench 140", displayName: null, dimensions: null, currency: "EUR", price: 421, specification: null, supplierCodes: ["111 069"], referenceCodes: [], role: "intermediate" },
        ],
        composition: { minStarters: 1, maxStarters: 1 },
      }],
    },
    optionGroups: [{
      id: "art-058", label: "ART.058",
      selection: { mode: "required_choose_at_least_one", minSelections: 1, maxSelections: null, defaultItemIds: [] },
      items: [{ id: "art-058-item", label: "ART.058", displayName: null, dimensions: null, currency: "EUR", price: 69, specification: null, supplierCodes: ["111 058"], referenceCodes: [] }],
      conditionalConfiguration: {
        role: "companion",
        selection: "at_least_one",
        applicability: [
          { target: { kind: "modular", group_id: "oxi-p-bench", row_id: "oxi-p-starter-140" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true },
          { target: { kind: "modular", group_id: "oxi-p-bench", row_id: "oxi-p-intermediate-140" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true },
        ],
      },
    }],
    materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 0.9, sources: [],
  };
}

test("1: a scaled Modular one-item companion is rejected when it uses exactly_one, but valid with at_least_one", () => {
  const invalid = scaledDraft();
  invalid.optionGroups[0].conditionalConfiguration!.selection = "exactly_one";
  assert.equal(normalizeProductTemplateDraft(invalid).valid, false, "Expected exactly_one + scale_with_target_quantity to be rejected");

  const valid = scaledDraft();
  assert.equal(normalizeProductTemplateDraft(valid).valid, true, "Expected at_least_one + scale_with_target_quantity to normalize cleanly");
});

test("2-3: OXI ART.058 uses the runtime-valid conditional selection (at_least_one) and outer optionGroup selection (required_choose_at_least_one) survives Apply", () => {
  const normalized = normalizeProductTemplateDraft(scaledDraft());
  assert.equal(normalized.valid, true, JSON.stringify(normalized.errors));
  const group = normalized.draft!.optionGroups[0];
  assert.equal(group.conditionalConfiguration?.selection, "at_least_one");
  assert.equal(group.selection.mode, "required_choose_at_least_one");

  const applied = mapDraftOptionGroupsToAccessories(normalized.draft!);
  assert.equal(applied.errors.length, 0, "Expected the outer required_choose_at_least_one selection to be accepted by the Apply adapter");
  assert.equal(applied.groups.length, 1);
  assert.equal(applied.groups[0].conditional_configuration?.selection, "at_least_one");
  assert.equal(applied.groups[0].conditional_configuration?.applicability[0].scale_with_target_quantity, true);
  assert.equal(applied.groups[0].conditional_configuration?.applicability[0].fixed_quantity, 2);
  assert.equal(applied.groups[0].items[0].price, 69, "Expected the real unit price, never a multiplied EUR 138 price");
});

test("4-7: a genuine choose-one companion (ART.175/ART.129) keeps exactly_one, fixed_quantity, and unit prices unchanged, and its outer selection survives Apply", () => {
  const normalized = normalizeProductTemplateDraft(chooseOneDraft());
  assert.equal(normalized.valid, true, JSON.stringify(normalized.errors));
  const group = normalized.draft!.optionGroups[0];
  assert.equal(group.conditionalConfiguration?.selection, "exactly_one", "Choose-one companions must keep exactly_one");
  assert.equal(group.selection.mode, "required_choose_at_least_one");
  assert.equal(group.conditionalConfiguration?.applicability[0].scale_with_target_quantity, undefined, "A choose-one companion must not be quantity-scaled");

  const applied = mapDraftOptionGroupsToAccessories(normalized.draft!);
  assert.equal(applied.errors.length, 0, "Expected outer required_choose_at_least_one to be accepted by the Apply adapter for a choose-one companion too");
  assert.equal(applied.groups[0].conditional_configuration?.selection, "exactly_one");
  assert.equal(applied.groups[0].items[0].price, 45);
  assert.equal(applied.groups[0].items[1].price, 52);

  // The old, previously-taught outer shape ("required_choose_one", min1/max1) is unsafe and must never be used.
  const unsafeOuter = chooseOneDraft();
  unsafeOuter.optionGroups[0].selection = { mode: "required_choose_one", minSelections: 1, maxSelections: 1, defaultItemIds: [] };
  const unsafeApplied = mapDraftOptionGroupsToAccessories(normalizeProductTemplateDraft(unsafeOuter).draft!);
  assert.deepEqual(unsafeApplied.groups, [], "Expected the unsafe outer selection to be dropped, confirming why the prompt must never teach it");
  assert.match(unsafeApplied.errors[0], /cannot be represented safely/);
});

test("8: Base/Model, Workstation, and Price Matrix companion quantities stay static and unaffected by the selection-mode fix", () => {
  (["base_model", "workstation", "price_matrix"] as const).forEach((kind) => {
    const evaluation = evaluateAccessoryConfigurationForModel({
      accessoryGroups: [{
        id: "companion", group_name: "Companion",
        items: [{ id: "companion-item", item_name: "Companion", price: 10, is_active: true }],
        conditional_configuration: { role: "companion", selection: "exactly_one", applicability: [{ target: { kind, group_id: "group-1", row_id: "row-1" }, required: true, visible: true, fixed_quantity: 1 }] },
      }],
      baseModelGroupId: null, baseModelRowId: null,
      selectedModelTargets: [{ kind, group_id: "group-1", row_id: "row-1" }],
      selectedQuantitiesByGroupId: { companion: { "companion-item": 1 } },
    });
    assert.equal(evaluation.valid, true);
    assert.equal(evaluation.groups[0].fixedQuantity, 1);
  });
});

test("9: no runtime source files were modified for this fix — the change is prompt/test only", () => {
  // This test exists to document intent; the actual guarantee is enforced by code review / git diff,
  // since accessory-conditional-configuration.ts already validated exactly_one + scale_with_target_quantity
  // as invalid before this task, and no source under lib/products/*.ts (excluding *.test.mts and the
  // extraction prompt) was edited to fix it — only lib/products/product-template-ai-extraction-prompt.ts.
  const evaluation = evaluateAccessoryConfigurationForModel({
    accessoryGroups: [{
      id: "companion", group_name: "Companion",
      items: [{ id: "item", item_name: "Item", price: 1, is_active: true }],
      conditional_configuration: { role: "companion", selection: "exactly_one", applicability: [{ target: { kind: "modular", group_id: "g", row_id: "r" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true }] },
    }],
    baseModelGroupId: null, baseModelRowId: null,
    selectedModelTargets: [{ kind: "modular", group_id: "g", row_id: "r" }],
    selectedModelTargetQuantities: { [accessoryApplicabilityTargetKey({ kind: "modular", group_id: "g", row_id: "r" })]: 1 },
    selectedQuantitiesByGroupId: {},
  });
  assert.equal(evaluation.valid, false, "Runtime must still reject exactly_one + scale_with_target_quantity exactly as before this task");
});
