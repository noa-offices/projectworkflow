import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveProductConfigurationState,
  type ProductConfigurationTemplateInput,
} from "./product-configuration-state.js";

function template(overrides: Partial<ProductConfigurationTemplateInput> = {}): ProductConfigurationTemplateInput {
  return {
    id: "tmpl-1",
    templateName: "MONOLITH",
    currency: "AED",
    defaultUnitPrice: 1000,
    ...overrides,
  };
}

// ── Fixture 1: default template price only ──────────────────────────────────────────────────

test("1. default template price only", () => {
  const result = resolveProductConfigurationState(template({ defaultUnitPrice: 1000 }), {});
  assert.equal(result.price.base, 1000);
  assert.equal(result.price.unit, 1000);
  assert.equal(result.nextRequiredStep, null);
  assert.equal(result.staleSelections.length, 0);
});

// ── Fixture 2: Base / Model row price ────────────────────────────────────────────────────────

const variantGroupSingle = [{
  id: "grp1", pricing_type: "base_model_group", group_name: "Models", is_active: true, sort_order: 0,
  items: [{ id: "row1", display_name: "1800x900", price: 500, is_active: true, sort_order: 0 }],
}];

test("2. Base / Model row price - single option auto-resolves", () => {
  const result = resolveProductConfigurationState(template({ variantPricing: variantGroupSingle }), {});
  assert.equal(result.price.base, 500);
  assert.equal(result.price.unit, 500);
  const rowStep = result.steps.find((step) => step.key === "variant_row")!;
  assert.equal(rowStep.autoResolved, true);
  assert.equal(result.nextRequiredStep, null);
});

// ── Fixture 3: Native System/Base + Main row ─────────────────────────────────────────────────

const systemGroup = [{
  id: "grp-sys", pricing_type: "base_model_group", group_name: "System", is_active: true, sort_order: 0,
  items: [
    { id: "sys1", role: "system_base", display_name: "System A", price: 100, is_active: true, sort_order: 0 },
    { id: "main1", display_name: "Main A", price: 200, is_active: true, sort_order: 1 },
    { id: "main2", display_name: "Main B", price: 300, is_active: true, sort_order: 2 },
  ],
}];

test("3. Native System/Base auto-selects when only one option; Main row stays required", () => {
  const noSelection = resolveProductConfigurationState(template({ variantPricing: systemGroup }), {});
  const systemStep = noSelection.steps.find((step) => step.key === "system_base")!;
  assert.equal(systemStep.autoResolved, true);
  assert.equal(systemStep.required, true);
  const rowStep = noSelection.steps.find((step) => step.key === "variant_row")!;
  assert.equal(rowStep.options.length, 2);
  assert.equal(rowStep.resolved, false);
  assert.equal(noSelection.nextRequiredStep?.key, "variant_row");

  const withSelection = resolveProductConfigurationState(template({ variantPricing: systemGroup }), { variantRowId: "main1" });
  assert.equal(withSelection.price.system, 100);
  assert.equal(withSelection.price.base, 200);
  assert.equal(withSelection.price.unit, 300);
  assert.equal(withSelection.nextRequiredStep, null);
});

// ── Fixture 4: Workstation / desking size ────────────────────────────────────────────────────

const deskingSingle = [{
  id: "wgrp1", pricing_type: "workstation_group", group_name: "Sizes", is_active: true, sort_order: 0,
  items: [{ id: "size1", label: "1800x900", default_price: 700, is_active: true, sort_order: 0 }],
}];

test("4. Workstation/desking size auto-resolves and drives base price", () => {
  const result = resolveProductConfigurationState(template({ deskingSizePricing: deskingSingle, defaultUnitPrice: 999 }), {});
  const step = result.steps.find((s) => s.key === "workstation_size")!;
  assert.equal(step.autoResolved, true);
  assert.equal(result.price.base, 700);
});

// ── Fixture 5: Category/Matrix row + category column ─────────────────────────────────────────

const categoryGroupSingle = [{
  id: "cgrp1", group_name: "Fabric", is_active: true, sort_order: 0, price_categories: ["Cat A", "Cat B"],
  items: [{ id: "crow1", display_name: "Chair Shell", prices: { "Cat A": 400, "Cat B": 450 }, is_active: true, sort_order: 0 }],
}];

test("5. Category/Matrix row auto-resolves; multiple finish columns stay unresolved until chosen", () => {
  const noColumn = resolveProductConfigurationState(template({ categoryPricing: categoryGroupSingle }), {});
  const fabricStep = noColumn.steps.find((s) => s.key === "fabric_category")!;
  assert.equal(fabricStep.resolved, false);
  assert.equal(noColumn.nextRequiredStep?.key, "fabric_category");

  const withColumn = resolveProductConfigurationState(template({ categoryPricing: categoryGroupSingle }), { fabricCategory: "Cat B" });
  assert.equal(withColumn.price.base, 450);
  assert.equal(withColumn.nextRequiredStep, null);
});

// ── Fixture 6: Direct modular composition ────────────────────────────────────────────────────

const directModularGroup = [{
  id: "mgrp1", pricing_type: "modular_group", group_name: "Modules", is_active: true, sort_order: 0,
  modular_pricing_mode: "direct",
  modular_composition: { min_starters: 1, max_starters: 1 },
  items: [
    { id: "starter1", pricing_type: "modular_item", modular_role: "starter", display_name: "Starter 90", price: 300, is_active: true, sort_order: 0 },
    { id: "inter1", pricing_type: "modular_item", modular_role: "intermediate", display_name: "Add-on 90", price: 150, is_active: true, sort_order: 1 },
  ],
}];

test("6. Direct modular composition enforces starter-before-intermediate and sums direct row prices", () => {
  const noStarter = resolveProductConfigurationState(template({ categoryPricing: directModularGroup }), { modularQuantities: { inter1: 1 } });
  assert.ok(noStarter.issues.some((issue) => issue.code === "starter_missing_for_intermediate"));

  const withStarter = resolveProductConfigurationState(template({ categoryPricing: directModularGroup }), { modularQuantities: { starter1: 1, inter1: 1 } });
  assert.equal(withStarter.issues.length, 0);
  assert.equal(withStarter.price.base, 450);
});

// ── Fixture 7: Matrix modular composition ────────────────────────────────────────────────────

const matrixModularGroup = [{
  id: "mgrp2", pricing_type: "modular_group", group_name: "Matrix Modules", is_active: true, sort_order: 0,
  items: [{ id: "mrow1", pricing_type: "modular_item", display_name: "Module A", prices: { "Cat A": 120, "Cat B": 140 }, is_active: true, sort_order: 0 }],
}];

test("7. Matrix modular composition is category-priced and carries no starter/composition rule", () => {
  const result = resolveProductConfigurationState(
    template({ categoryPricing: matrixModularGroup }),
    { modularQuantities: { mrow1: 2 }, fabricCategory: "Cat B" },
  );
  assert.equal(result.price.base, 280);
  const modularStep = result.steps.find((step) => step.key.startsWith("modular:"))!;
  assert.equal(modularStep.required, false);
  assert.equal(result.steps.some((step) => step.key === "category_group"), false);
});

// ── Fixture 8: optional accessory additive price ─────────────────────────────────────────────

const accessoryGroupOptional = [{
  id: "agrp1", group_name: "Add-ons", group_is_required: false, is_active: true, sort_order: 0,
  items: [{ id: "acc1", item_name: "Cable Tray", price: 50, currency: "AED", is_active: true, sort_order: 0, role: "normal" }],
}];

test("8. Optional accessory is additive only when selected", () => {
  const withoutAccessory = resolveProductConfigurationState(template({ variantPricing: variantGroupSingle, accessoryPricing: accessoryGroupOptional }), {});
  assert.equal(withoutAccessory.price.unit, 500);

  const withAccessory = resolveProductConfigurationState(
    template({ variantPricing: variantGroupSingle, accessoryPricing: accessoryGroupOptional }),
    { accessoryQuantities: { acc1: 2 } },
  );
  assert.equal(withAccessory.price.accessories, 100);
  assert.equal(withAccessory.price.unit, 600);
});

// ── Fixture 9: required companion auto-quantity ──────────────────────────────────────────────

const companionGroup = [{
  id: "cgrp-comp", group_name: "Cable Management", is_active: true, sort_order: 0,
  items: [{ id: "comp1", item_name: "Cable Tray", price: 40, is_active: true, sort_order: 0, role: "companion" }],
  conditional_configuration: {
    role: "companion", selection: "exactly_one",
    applicability: [{ base_model_group_id: "grp1", base_model_row_id: "row1", required: true, visible: true, allowed_item_ids: ["comp1"], fixed_quantity: 1 }],
  },
}];

test("9. Required companion is auto-applied - never presented as a normal accessory question", () => {
  const result = resolveProductConfigurationState(
    template({ variantPricing: variantGroupSingle, accessoryPricing: companionGroup }),
    {},
  );
  assert.ok(result.autoApplied.some((entry) => entry.optionId === "comp1"));
  const accessoryStep = result.steps.find((step) => step.key === "accessory");
  assert.equal(accessoryStep?.options.some((option) => option.id === "comp1") ?? false, false);
  assert.equal(result.price.accessories, 40);
});

// ── Fixture 10: structural support compatibility ─────────────────────────────────────────────

const twoGroupVariant = [
  { id: "grpA", pricing_type: "base_model_group", group_name: "Group A", is_active: true, sort_order: 0, items: [{ id: "rowA1", display_name: "A1", price: 100, is_active: true, sort_order: 0 }] },
  { id: "grpB", pricing_type: "base_model_group", group_name: "Group B", is_active: true, sort_order: 1, items: [{ id: "rowB1", display_name: "B1", price: 200, is_active: true, sort_order: 0 }] },
];
const structuralSupportAccessory = [{
  id: "sgrp1", group_name: "Support", is_active: true, sort_order: 0,
  items: [{ id: "sup1", item_name: "Leg Support", price: 60, is_active: true, sort_order: 0, role: "structural_support", compatible_targets: [{ kind: "base_model", group_id: "grpA", row_id: "rowA1" }] }],
}];

test("10. Structural support is only shown when compatible with the current Base/Model selection", () => {
  const compatible = resolveProductConfigurationState(
    template({ variantPricing: twoGroupVariant, accessoryPricing: structuralSupportAccessory }),
    { variantGroupId: "grpA", variantRowId: "rowA1" },
  );
  assert.ok(compatible.steps.find((step) => step.key === "structural_support")?.options.some((option) => option.id === "sup1"));

  const incompatible = resolveProductConfigurationState(
    template({ variantPricing: twoGroupVariant, accessoryPricing: structuralSupportAccessory }),
    { variantGroupId: "grpB", variantRowId: "rowB1" },
  );
  assert.equal(incompatible.steps.find((step) => step.key === "structural_support"), undefined);
});

// ── Fixture 11: stale accessory/model selection ──────────────────────────────────────────────

test("11. Stale selections are reported, ignored, and never guessed - a single remaining valid option still auto-resolves", () => {
  const result = resolveProductConfigurationState(
    template({ variantPricing: variantGroupSingle, accessoryPricing: accessoryGroupOptional }),
    { variantRowId: "does-not-exist", accessoryQuantities: { "ghost-item": 3 } },
  );
  assert.ok(result.staleSelections.some((entry) => entry.key === "variantRowId" && entry.id === "does-not-exist"));
  assert.ok(result.staleSelections.some((entry) => entry.key === "accessoryQuantities" && entry.id === "ghost-item"));
  assert.equal(result.price.base, 500);
  const rowStep = result.steps.find((step) => step.key === "variant_row")!;
  assert.equal(rowStep.autoResolved, true);
});

// ── Fixture 12: one-choice auto-resolution (system + group + row + workstation + category) ──

test("12. Every dimension with exactly one valid option auto-resolves without a stale-id round-trip", () => {
  const result = resolveProductConfigurationState(
    template({ variantPricing: variantGroupSingle, categoryPricing: categoryGroupSingle, deskingSizePricing: deskingSingle }),
    { fabricCategory: "Cat A" },
  );
  assert.ok(result.autoApplied.some((entry) => entry.stepKey === "variant_group"));
  assert.ok(result.autoApplied.some((entry) => entry.stepKey === "variant_row"));
  assert.ok(result.autoApplied.some((entry) => entry.stepKey === "workstation_size"));
  assert.ok(result.autoApplied.some((entry) => entry.stepKey === "category_group"));
  assert.ok(result.autoApplied.some((entry) => entry.stepKey === "category_row"));
});

// ── Fixture 13: multiple required choices -> nextRequiredStep in dependency order ───────────

test("13. nextRequiredStep is the FIRST unresolved required step in dependency order, not just the first pushed", () => {
  const result = resolveProductConfigurationState(
    template({ variantPricing: twoGroupVariant, categoryPricing: categoryGroupSingle }),
    {},
  );
  // variant_group (2 groups, unresolved) precedes category_group in dependency order.
  assert.equal(result.nextRequiredStep?.key, "variant_group");
});

// ── Fixture 14: unavailable category rejected ────────────────────────────────────────────────

const categoryWithUnavailable = [{
  id: "cgrp2", group_name: "Fabric", is_active: true, sort_order: 0, price_categories: ["Cat A", "Cat B"],
  items: [{ id: "crow2", display_name: "Chair Shell", prices: { "Cat A": 400, "Cat B": 450 }, unavailable_categories: ["Cat B"], is_active: true, sort_order: 0 }],
}];

test("14. A category marked unavailable for the selected row is excluded, and a stale request for it is reported", () => {
  const result = resolveProductConfigurationState(
    template({ categoryPricing: categoryWithUnavailable }),
    { fabricCategory: "Cat B" },
  );
  const fabricStep = result.steps.find((step) => step.key === "fabric_category")!;
  assert.equal(fabricStep.options.some((option) => option.id === "Cat B"), false);
  assert.ok(result.staleSelections.some((entry) => entry.key === "fabricCategory" && entry.id === "Cat B"));
  // Only "Cat A" remains valid, so it auto-resolves despite the stale request.
  assert.equal(result.price.base, 400);
});

// ── Fixture 15: mixed/missing currency case ──────────────────────────────────────────────────

const eurAccessory = [{
  id: "agrp-eur", group_name: "Imported Add-on", group_is_required: false, is_active: true, sort_order: 0,
  items: [{ id: "eur-acc1", item_name: "EU Component", price: 80, currency: "EUR", is_active: true, sort_order: 0, role: "normal" }],
}];

test("15. A non-matching-currency accessory is excluded from unit and reported, never converted with a guessed rate", () => {
  const result = resolveProductConfigurationState(
    template({ variantPricing: variantGroupSingle, accessoryPricing: eurAccessory, currency: "AED" }),
    { accessoryQuantities: { "eur-acc1": 1 } },
  );
  assert.equal(result.price.accessories, 0);
  assert.equal(result.price.unit, 500);
  assert.ok(result.price.missingExchangeRateCurrencies.includes("EUR"));
  assert.ok(result.issues.some((issue) => issue.code === "missing_exchange_rate"));
});
