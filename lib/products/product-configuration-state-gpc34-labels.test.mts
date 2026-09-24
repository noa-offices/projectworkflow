// GPC-3.4: human-friendly accessory / required-option labels. Presentation-only against the
// PROVEN Product Library data shape (item_name / supplier_price_list_code / specification) -
// never a pricing or configuration-rule change (see product-configuration-state.test.mts for
// those). Focused on lib/products/product-configuration-state.ts's accessory option label/
// supplierCode output only.
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
    currency: "EUR",
    defaultUnitPrice: 1000,
    ...overrides,
  };
}

const variantGroupSingle = [{
  id: "grp1", pricing_type: "base_model_group", group_name: "Models", is_active: true, sort_order: 0,
  items: [{ id: "row1", display_name: "1800x900", price: 500, is_active: true, sort_order: 0 }],
}];

// PROVEN Product Library shape: item_name equal to the supplier code (UAT's actual bug), a
// specification sentence to derive a concise label from, and a subgroup carrying a leading
// measurement token.
const serviceUnitRequired = [{
  id: "service-units", group_name: "Service Unit", is_active: true, sort_order: 0,
  subgroups: [{ id: "sg-123", subgroup_name: "123 cm service unit", sort_order: 0, is_active: true, row_ids: ["1af-090", "1af-091"] }],
  items: [
    { id: "1af-090", item_name: "1AF 090", supplier_price_list_code: "1AF 090", specification: "Right service unit with adjustable feet.", price: 1042, currency: "EUR", is_active: true, sort_order: 0, role: "normal" },
    { id: "1af-091", item_name: "1AF 091", supplier_price_list_code: "1AF 091", specification: "Left service unit with adjustable feet.", price: 1042, currency: "EUR", is_active: true, sort_order: 1, role: "normal" },
  ],
  conditional_configuration: {
    role: "conditional_option", selection: "exactly_one",
    applicability: [{ base_model_group_id: "grp1", base_model_row_id: "row1", required: true, visible: true, allowed_item_ids: ["1af-090", "1af-091"], fixed_quantity: 1 }],
  },
}];

const modestyPanelOptional = [{
  id: "modesty", group_name: "Modesty Panel", group_is_required: false, is_active: true, sort_order: 1,
  items: [
    { id: "panel-standard", item_name: "Standard Modesty Panel", supplier_price_list_code: "1AF 044", specification: "Standard modesty panel.", price: 154, currency: "EUR", is_active: true, sort_order: 0, role: "normal" },
    { id: "panel-privacy", item_name: "Privacy Modesty Panel", supplier_price_list_code: "1AF 045", specification: "Privacy modesty panel.", price: 195, currency: "EUR", is_active: true, sort_order: 1, role: "normal" },
  ],
}];

function serviceUnitStep(overrides: Partial<ProductConfigurationTemplateInput> = {}, selections = {}) {
  const result = resolveProductConfigurationState(
    template({ variantPricing: variantGroupSingle, accessoryPricing: serviceUnitRequired, ...overrides }),
    selections,
  );
  return result.steps.find((step) => step.key === "accessory:service-units")!;
}

function modestyStep(selections = {}) {
  const result = resolveProductConfigurationState(
    template({ variantPricing: variantGroupSingle, accessoryPricing: modestyPanelOptional }),
    selections,
  );
  return result.steps.find((step) => step.key === "accessory:modesty")!;
}

// 1/3/12: item_name identical to the supplier code falls back to a specification-derived human
// label, with the supplier code carried as secondary/fallback (never the primary label) and the
// internal item id (e.g. "1af-090") never surfacing as the label even though it's available.
test("1/3/12. Service Unit item_name identical to supplier code uses a specification-derived label, never the code or internal id", () => {
  const step = serviceUnitStep();
  const right = step.options.find((option) => option.id === "1af-090")!;
  assert.equal(right.label, "Right Service Unit — 123 cm");
  assert.equal(right.supplierCode, "1AF 090");
  assert.notEqual(right.label, "1af-090");
  assert.notEqual(right.label, "1AF 090");
});

// 2. A genuinely descriptive item_name (Modesty Panel) is kept as-is, never replaced by the code.
test("2. Good item_name (Modesty Panel) remains the main label", () => {
  const step = modestyStep();
  const standard = step.options.find((option) => option.id === "panel-standard")!;
  const privacy = step.options.find((option) => option.id === "panel-privacy")!;
  assert.equal(standard.label, "Standard Modesty Panel");
  assert.equal(privacy.label, "Privacy Modesty Panel");
  assert.equal(standard.supplierCode, "1AF 044");
  assert.equal(privacy.supplierCode, "1AF 045");
});

// 4. Price/currency are untouched by the label change.
test("4. Price/currency remain correct alongside the new label", () => {
  const step = serviceUnitStep();
  const right = step.options.find((option) => option.id === "1af-090")!;
  assert.equal(right.priceContribution, 1042);
  assert.equal(right.priceCurrency, "EUR");
});

// 11. No pricing/configuration-rule behavior changed: selecting still prices and resolves exactly
// as GPC-3.3 proved.
test("11. No pricing/configuration behavior change - selection still resolves and prices correctly", () => {
  const before = serviceUnitStep();
  assert.equal(before.required, true);
  assert.equal(before.resolved, false);

  const after = resolveProductConfigurationState(
    template({ variantPricing: variantGroupSingle, accessoryPricing: serviceUnitRequired }),
    { accessoryQuantities: { "1af-090": 1 } },
  );
  assert.equal(after.price.accessories, 1042);
  assert.equal(after.price.unit, 1542);
  assert.equal(after.nextRequiredStep, null);
});
