import assert from "node:assert/strict";
import test from "node:test";
import { getProductTemplateAiExtractionPrompt, extractionPromptFocuses } from "./product-template-ai-extraction-prompt.js";
import { PRODUCT_TEMPLATE_DRAFT_VERSION, normalizeProductTemplateDraft, type ProductTemplateDraft } from "./product-template-draft.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";
import { mapDraftModularPricing } from "./product-template-draft-modular-adapter.js";
import { createSmartSetupReviewRouting } from "./smart-product-review-routing.js";
import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups.js";
import { LEGACY_WORKSTATION_GROUP_ID } from "./workstation-pricing-groups.js";
import { isDirectModularPricingGroup, modularCompositionRule, modularRowRole } from "./modular-pricing.js";

/** The exact string the Smart Product Setup UI copies for the Workstation focus. */
const generated = getProductTemplateAiExtractionPrompt("workstation");

function emptyDraft(): ProductTemplateDraft {
  return {
    version: PRODUCT_TEMPLATE_DRAFT_VERSION,
    template: { templateName: "OXI", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: "EUR",
    pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] },
    optionGroups: [],
    materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 0.95, sources: [],
  };
}

const APPLY_SAFE_REQUIRED_SELECTION = { mode: "required_choose_at_least_one" as const, minSelections: 1, maxSelections: null, defaultItemIds: [] };

// ---------------------------------------------------------------------------
// 17. Generated-prompt regression invariants (asserted against the final string)
// ---------------------------------------------------------------------------

test("generated prompt JSON rules: no valid example teaches \\_ , the escaped-quote example parses, and confidence is 0..1", () => {
  // 1-2. The only \_ occurrences are the forbidding rule itself and the line directly under "INVALID JSON:".
  const promptLines = generated.split("\n");
  const invalidEscapeIndexes = promptLines.flatMap((line, index) => line.includes("\\_") ? [index] : []);
  assert.ok(invalidEscapeIndexes.length > 0, "Expected the prompt to demonstrate the forbidden escape at least once");
  invalidEscapeIndexes.forEach((index) => {
    const line = promptLines[index];
    const labelledInvalid = (promptLines[index - 1] ?? "").trim() === "INVALID JSON:";
    const forbidsIt = line.includes("Never emit \\_") || line.includes("are INVALID") || line.includes("no \\_,");
    assert.ok(
      labelledInvalid || forbidsIt,
      `Expected every \\_ occurrence to be marked invalid, found: ${line.slice(0, 160)}`,
    );
  });
  assert.ok(generated.includes('"rawText": "BENCH ... \\"OXI_P\\" ..."'), "Expected the VALID escaped-quote example");
  assert.doesNotThrow(() => JSON.parse(`{${'"rawText": "BENCH ... \\"OXI_P\\" ..."'}}`), "Expected the VALID example to actually parse");

  // 3-4. Confidence range stated once, consistently, with the 95% example.
  assert.ok(generated.includes("confidence must be null or a number from 0 through 1"));
  assert.ok(generated.includes("Use 0.95 for 95%"));
  assert.ok(!/confidence[^.]{0,80}0\s*(?:through|to|-)\s*100/i.test(generated), "Expected no 0..100 confidence guidance anywhere");
});

test("generated prompt documents Direct Modular fully and keeps it mutually exclusive with Matrix Modular", () => {
  [
    // 5-8. directRows, scalar price, role, composition.
    '"pricingMode": "direct"',
    '"directRows"',
    '"role": "starter"',
    '"composition": { "minStarters": 1, "maxStarters": 1 }',
    // 9-10. Mode exclusivity.
    'DIRECT MODULAR: pricingMode: "direct" with directRows; OMIT matrix entirely.',
    "MATRIX MODULAR: matrix with rows/prices; OMIT directRows",
    "Never emit an empty matrix as a placeholder inside a direct Modular group.",
  ].forEach((expected) => assert.ok(generated.includes(expected), `Expected generated prompt to document: ${expected}`));
});

test("generated prompt targeting rules follow actual pricing routing and never use supplier codes as row ids", () => {
  [
    // 11. Direct Modular uses a modular target.
    'for OXI_P Direct Modular, ART.058 targets those exact directRows',
    'use { kind: "modular", group_id: "<that exact modularGroup.id>", row_id: "<that exact modular row.id>" }',
    // 12-13. Sentinels, imported from the real runtime constants.
    `group_id: "${LEGACY_BASE_MODEL_GROUP_ID}"`,
    `group_id: "${LEGACY_WORKSTATION_GROUP_ID}"`,
    // 14. row_id is the draft row id, not the supplier code.
    'row_id is the row\'s own draft id, never its supplierCodes entry ("111 623")',
  ].forEach((expected) => assert.ok(generated.includes(expected), `Expected generated prompt to contain targeting rule: ${expected}`));
});

test("generated prompt teaches exactly one companion selection rule for both companion shapes", () => {
  [
    // 15-17. One authoritative rule; both shapes share the Apply-safe outer selection.
    "COMPANION SELECTION MODE — CHOOSE-ONE VS QUANTITY-SCALED",
    'A. CHOOSE-ONE COMPANION',
    'conditionalConfiguration.selection = "exactly_one"',
    'B. QUANTITY-SCALED REQUIRED COMPANION',
    'conditionalConfiguration.selection = "at_least_one"',
    'Both shapes use the identical outer optionGroup.selection',
    // 18-19. The scaled shape carries both quantity fields.
    "Set fixed_quantity to the manufacturer's per-row quantity and scale_with_target_quantity: true",
    // 20-21. The two forbidden combinations.
    'the runtime rejects scale_with_target_quantity combined with "exactly_one"',
    'Never use outer optionGroup.selection.mode "required_choose_one" or "choose_one" for a Required Companion group',
  ].forEach((expected) => assert.ok(generated.includes(expected), `Expected generated prompt companion rule: ${expected}`));
});

test("generated prompt restricts the outer optionGroup selection to the three Apply-safe shapes", () => {
  [
    "OUTER OPTIONGROUP.SELECTION — APPLY-SAFE SHAPES ONLY",
    '{ "mode": "optional", "minSelections": 0, "maxSelections": null, "defaultItemIds": [] }',
    '{ "mode": "choose_multiple", "minSelections": 0, "maxSelections": null, "defaultItemIds": [] }',
    '{ "mode": "required_choose_at_least_one", "minSelections": 1, "maxSelections": null, "defaultItemIds": [] }',
    'Never emit "choose_one" or "required_choose_one", and never emit a non-empty defaultItemIds',
  ].forEach((expected) => assert.ok(generated.includes(expected), `Expected generated prompt to contain: ${expected}`));
  assert.ok(!generated.includes('Use only these selection modes: "optional", "choose_one"'), "Expected the stale permissive selection-mode list to be gone");
});

test("generated prompt OXI examples keep source unit prices and Direct Modular roles", () => {
  [
    // 22-23. Unit price preserved, no synthetic multiplied price.
    "ART.058 at supplier code 111 058, unit price EUR 69, remains one row priced at EUR 69, never a synthesized EUR 138 item",
    'Never synthesize a bundled/multiplied item such as "2 x ART.058"',
    // 24. OXI_P direct modular starter/intermediate roles.
    "use directRows with the respective starter/intermediate roles and composition minStarters: 1, maxStarters: 1",
  ].forEach((expected) => assert.ok(generated.includes(expected), `Expected generated prompt OXI rule: ${expected}`));
});

test("the contract example presents one entry per shape instead of one mixed misleading sample", () => {
  assert.ok(generated.includes("optionGroups shows an ordinary category-priced accessory (no conditionalConfiguration) followed by a Required Companion"));
  // The ordinary accessory entry must not carry companion semantics.
  const contractStart = generated.indexOf('"optionGroups": [{');
  const contractLine = generated.slice(contractStart, generated.indexOf("\n", contractStart));
  const ordinary = contractLine.slice(0, contractLine.indexOf('"mode": "required_choose_at_least_one"'));
  assert.ok(!ordinary.includes("conditionalConfiguration"), "Expected the ordinary accessory contract entry to omit conditionalConfiguration");
  assert.ok(contractLine.includes('"conditionalConfiguration": { "role": "companion", "selection": "exactly_one"'), "Expected the companion entry to carry conditionalConfiguration");
});

test("every focus keeps the same JSON, confidence, and companion rules", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(prompt.includes("confidence must be null or a number from 0 through 1"), `Expected ${focus} to state the 0..1 confidence range`);
    assert.ok(prompt.includes("OUTER OPTIONGROUP.SELECTION — APPLY-SAFE SHAPES ONLY"), `Expected ${focus} to restrict outer selections`);
    assert.ok(prompt.includes("COMPANION SELECTION MODE — CHOOSE-ONE VS QUANTITY-SCALED"), `Expected ${focus} to carry the single companion rule`);
  });
});

// ---------------------------------------------------------------------------
// 18. Structural contract tests: representative objects must survive for real
// ---------------------------------------------------------------------------

test("structural A: a choose-one companion survives normalization, review routing, and Apply", () => {
  const draft = emptyDraft();
  draft.pricing.workstationRows = [{ id: "oxi-q-ws-dx", label: "OXI Q DX", displayName: null, dimensions: null, currency: "EUR", price: 1200, additionalPrice: null, layoutType: null, specification: null, supplierCodes: ["111 623"], referenceCodes: [] }];
  draft.optionGroups = [{
    id: "leg-choice", label: "Required Leg", selection: APPLY_SAFE_REQUIRED_SELECTION,
    items: [
      { id: "art-175", label: "ART.175", displayName: null, dimensions: null, currency: "EUR", price: 45, specification: null, supplierCodes: ["ART.175"], referenceCodes: [] },
      { id: "art-129", label: "ART.129", displayName: null, dimensions: null, currency: "EUR", price: 52, specification: null, supplierCodes: ["ART.129"], referenceCodes: [] },
    ],
    conditionalConfiguration: {
      role: "companion", selection: "exactly_one",
      applicability: [{ target: { kind: "workstation", group_id: LEGACY_WORKSTATION_GROUP_ID, row_id: "oxi-q-ws-dx" }, required: true, visible: true, allowed_item_ids: ["art-175", "art-129"] }],
    },
  }];

  const normalized = normalizeProductTemplateDraft(draft);
  assert.equal(normalized.valid, true, JSON.stringify(normalized.errors));

  const applied = mapDraftOptionGroupsToAccessories(normalized.draft!, createSmartSetupReviewRouting(normalized.draft!));
  assert.equal(applied.errors.length, 0);
  const configuration = applied.groups[0].conditional_configuration!;
  assert.equal(configuration.role, "companion");
  assert.equal(configuration.selection, "exactly_one");
  assert.equal(configuration.applicability.length, 1, "Review routing must not discard the draft's applicability");
  assert.deepEqual(configuration.applicability[0].target, { kind: "workstation", group_id: LEGACY_WORKSTATION_GROUP_ID, row_id: "oxi-q-ws-dx" });
  assert.deepEqual(configuration.applicability[0].allowed_item_ids, ["art-175", "art-129"]);
  assert.equal(applied.groups[0].items[0].price, 45);
  assert.equal(applied.groups[0].items[1].price, 52);
});

test("structural B + 19: a quantity-scaled Modular companion keeps fixed_quantity and scaling through review routing and Apply", () => {
  const draft = emptyDraft();
  draft.pricing.modularGroups = [{
    id: "oxi-p-bench", label: "OXI_P Bench", defaultDimensions: null, defaultSpecification: null, pricingMode: "direct",
    directRows: [
      { id: "oxi-p-starter-140", label: "Starter 140", displayName: null, dimensions: null, currency: "EUR", price: 425, specification: null, supplierCodes: ["111 065"], referenceCodes: [], role: "starter" },
      { id: "oxi-p-intermediate-140", label: "Intermediate 140", displayName: null, dimensions: null, currency: "EUR", price: 421, specification: null, supplierCodes: ["111 069"], referenceCodes: [], role: "intermediate" },
    ],
    composition: { minStarters: 1, maxStarters: 1 },
  }];
  draft.optionGroups = [{
    id: "art-058", label: "ART.058", selection: APPLY_SAFE_REQUIRED_SELECTION,
    items: [{ id: "art-058-item", label: "ART.058", displayName: null, dimensions: null, currency: "EUR", price: 69, specification: null, supplierCodes: ["111 058"], referenceCodes: [] }],
    conditionalConfiguration: {
      role: "companion", selection: "at_least_one",
      applicability: [
        { target: { kind: "modular", group_id: "oxi-p-bench", row_id: "oxi-p-starter-140" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true },
        { target: { kind: "modular", group_id: "oxi-p-bench", row_id: "oxi-p-intermediate-140" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true },
      ],
    },
  }];

  const normalized = normalizeProductTemplateDraft(draft);
  assert.equal(normalized.valid, true, JSON.stringify(normalized.errors));

  // The human-review path is the normal Smart Setup flow and must not drop scaling.
  const reviewed = mapDraftOptionGroupsToAccessories(normalized.draft!, createSmartSetupReviewRouting(normalized.draft!));
  assert.equal(reviewed.errors.length, 0);
  const reviewedRules = reviewed.groups[0].conditional_configuration!.applicability;
  assert.equal(reviewedRules.length, 2, "Review routing must preserve every draft applicability rule");
  reviewedRules.forEach((rule) => {
    assert.equal(rule.fixed_quantity, 2);
    assert.equal(rule.scale_with_target_quantity, true);
    assert.equal(rule.target?.kind, "modular");
  });
  assert.equal(reviewed.groups[0].items[0].price, 69, "The companion keeps its source unit price, never a multiplied total");

  // The direct-apply path (no reviewer) must behave identically.
  const direct = mapDraftOptionGroupsToAccessories(normalized.draft!);
  assert.equal(direct.groups[0].conditional_configuration!.applicability[0].scale_with_target_quantity, true);
});

test("structural C: OXI_P Direct Modular survives normalization and the Modular Apply adapter with roles and composition", () => {
  const draft = emptyDraft();
  draft.pricing.modularGroups = [{
    id: "oxi-p-bench", label: "OXI_P Bench", defaultDimensions: null, defaultSpecification: null, pricingMode: "direct",
    directRows: [
      { id: "oxi-p-starter-140", label: "Starter 140", displayName: null, dimensions: null, currency: "EUR", price: 425, specification: null, supplierCodes: ["111 065"], referenceCodes: [], role: "starter", importantRequirements: ["Move the panel to terminal position to finish the composition."] },
      { id: "oxi-p-intermediate-140", label: "Intermediate 140", displayName: null, dimensions: null, currency: "EUR", price: 421, specification: null, supplierCodes: ["111 069"], referenceCodes: [], role: "intermediate" },
    ],
    composition: { minStarters: 1, maxStarters: 1 },
  }];

  const normalized = normalizeProductTemplateDraft(draft);
  assert.equal(normalized.valid, true, JSON.stringify(normalized.errors));

  const mapped = mapDraftModularPricing(normalized.draft!);
  assert.equal(mapped.compatible, true);
  const group = mapped.groups[0];
  assert.equal(isDirectModularPricingGroup(group), true);
  assert.deepEqual(group.price_categories, [], "A direct group must never gain fake category columns");
  assert.deepEqual(modularCompositionRule(group), { minStarters: 1, maxStarters: 1 });
  assert.equal(modularRowRole(group.items[0]), "starter");
  assert.equal(modularRowRole(group.items[1]), "intermediate");
  assert.equal(Number((group.items[0] as { price?: number | null }).price), 425);
  assert.equal(Number((group.items[1] as { price?: number | null }).price), 421);

  // Review routing sees the direct group as a Modular route with no columns.
  const route = createSmartSetupReviewRouting(normalized.draft!).routes.find((item) => item.key === "modular:oxi-p-bench")!;
  assert.equal(route.destination, "modular");
  assert.equal(route.rowCount, 2);
  assert.equal(route.columnCount, 0);
});

test("the legacy specification heuristic still fills in rules for a companion group that arrived without any", () => {
  const draft = emptyDraft();
  draft.pricing.baseModelRows = [{ id: "desk-160", label: "Desk 160", displayName: null, dimensions: null, currency: "EUR", price: 900, specification: "Always complete with 1 service unit.", supplierCodes: ["D160"], referenceCodes: [] }];
  draft.optionGroups = [{
    id: "service-units", label: "Service Units", selection: APPLY_SAFE_REQUIRED_SELECTION,
    items: [{ id: "unit-a", label: "Service Unit", displayName: null, dimensions: null, currency: "EUR", price: 300, specification: null, supplierCodes: ["SU-A"], referenceCodes: [] }],
    // A companion with no applicability of its own: the guard must let the heuristic populate it.
    conditionalConfiguration: { role: "companion", selection: "at_least_one", applicability: [] },
  }];
  const normalized = normalizeProductTemplateDraft(draft);
  assert.equal(normalized.valid, true, JSON.stringify(normalized.errors));
  const applied = mapDraftOptionGroupsToAccessories(normalized.draft!, createSmartSetupReviewRouting(normalized.draft!));
  const rules = applied.groups[0].conditional_configuration?.applicability ?? [];
  assert.equal(rules.length, 1, "Expected the legacy heuristic to still create a rule when the draft supplied none");
  assert.equal(rules[0].base_model_row_id, "desk-160");
});
