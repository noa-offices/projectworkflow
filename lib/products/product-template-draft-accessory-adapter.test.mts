import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_TEMPLATE_DRAFT_VERSION, type ProductTemplateDraft, type ProductTemplateDraftSelectionMode } from "./product-template-draft.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";
import { createSmartSetupReviewRouting } from "./smart-product-review-routing.js";

function draft(mode: ProductTemplateDraftSelectionMode, minSelections: number, maxSelections: number | null, defaultItemIds: string[] = []): ProductTemplateDraft {
  return {
    version: PRODUCT_TEMPLATE_DRAFT_VERSION,
    template: { templateName: null, templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: null,
    pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] },
    optionGroups: [{ id: "feet", label: "Feet", selection: { mode, minSelections, maxSelections, defaultItemIds }, items: [
      { id: "standard", label: "Standard", displayName: null, dimensions: null, currency: "EUR", price: 0, specification: null, supplierCodes: ["STD"], referenceCodes: [] },
      { id: "chrome", label: "Chrome", displayName: null, dimensions: null, currency: null, price: 75, specification: "Chrome", supplierCodes: ["CHR", "EXTRA"], referenceCodes: [] },
    ] }],
    materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
  };
}

test("safe accessory groups preserve prices, order, required state, and code warnings", () => {
  const optional = mapDraftOptionGroupsToAccessories(draft("optional", 0, null));
  assert.equal(optional.groups[0].items[0].price, 0);
  assert.equal(optional.groups[0].items[1].price, 75);
  assert.equal(optional.groups[0].items[0].supplier_price_list_code, "STD");
  assert.match(optional.warnings[0], /only the primary code/);
  const required = mapDraftOptionGroupsToAccessories(draft("required_choose_at_least_one", 1, null));
  assert.equal(required.groups[0].group_is_required, true);
});

test("accessory dimensions preserve authoritative raw source text", () => {
  const source = draft("optional", 0, null);
  source.optionGroups[0].items[0] = { ...source.optionGroups[0].items[0], dimensions: { width: 90, depth: 37, height: null, diameter: null, unit: "cm", rawText: " L.90 x p.37 " } };
  source.optionGroups[0].items[1] = { ...source.optionGroups[0].items[1], dimensions: null };
  const result = mapDraftOptionGroupsToAccessories(source);
  assert.equal(result.groups[0].items[0].dimension, "L.90 x p.37");
  assert.equal("dimension" in result.groups[0].items[1], false);
});

test("human-readable display names take precedence over code-like labels without changing code or configuration mapping", () => {
  const source = draft("optional", 0, 1);
  source.optionGroups[0].items[0] = { ...source.optionGroups[0].items[0], id: "service-right", label: "1AF 090", displayName: "Service Unit W123.6 - Right", supplierCodes: ["1AF 090"], referenceCodes: [] };
  source.optionGroups[0].items[1] = { ...source.optionGroups[0].items[1], id: "label-only", label: "Chrome frame", displayName: null, supplierCodes: [], referenceCodes: ["REF-1"] };
  source.optionGroups[0].items.push({ ...source.optionGroups[0].items[1], id: "id-only", label: null, displayName: null, supplierCodes: [], referenceCodes: [] });
  const result = mapDraftOptionGroupsToAccessories(source);
  assert.equal(result.groups[0].items[0].item_name, "Service Unit W123.6 - Right");
  assert.equal(result.groups[0].items[0].supplier_price_list_code, "1AF 090");
  assert.equal(result.groups[0].items[1].item_name, "Chrome frame");
  assert.equal(result.groups[0].items[1].supplier_price_list_code, "REF-1");
  assert.equal(result.groups[0].items[2].item_name, "id-only");
  assert.equal(result.groups[0].items[0].price, 0);
  assert.deepEqual(result.groups[0].conditional_configuration, { role: "accessory", selection: "exactly_one", applicability: [] });
});

test("unsafe exact-choice and default semantics produce no replacement groups", () => {
  const result = mapDraftOptionGroupsToAccessories(draft("required_choose_one", 1, 1, ["standard"]));
  assert.deepEqual(result.groups, []);
  assert.match(result.errors[0], /cannot be represented safely/);
});

test("optional maximum-one groups map to exactly-one configuration without an obsolete warning", () => {
  const result = mapDraftOptionGroupsToAccessories(draft("optional", 0, 1));
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.groups[0].conditional_configuration, { role: "accessory", selection: "exactly_one", applicability: [] });
});

test("category-priced accessories apply without flattening group categories or item prices", () => {
  const source = draft("optional", 0, null);
  source.optionGroups[0].priceCategories = [{ id: "cat-b", label: "B (Crepe / Time)" }, { id: "cat-supreme", label: "SUPREME" }];
  source.optionGroups[0].items[0] = { ...source.optionGroups[0].items[0], price: null, prices: { "cat-b": 93, "cat-supreme": 162 } };
  source.optionGroups[0].items[1] = { ...source.optionGroups[0].items[1], price: null, prices: { "cat-b": 107, "cat-supreme": 189 } };
  source.optionGroups[0].priceCategories = source.optionGroups[0].priceCategories.map((category) => category.id === "cat-b" ? { ...category, label: "B" } : category);
  const result = mapDraftOptionGroupsToAccessories(source);
  assert.deepEqual(result.groups[0].price_categories, source.optionGroups[0].priceCategories);
  assert.deepEqual(result.groups[0].price_categories, [{ id: "cat-b", label: "B" }, { id: "cat-supreme", label: "SUPREME" }]);
  assert.deepEqual(result.groups[0].items[0].prices, { "cat-b": 93, "cat-supreme": 162 });
  assert.deepEqual(result.groups[0].items[1].prices, { "cat-b": 107, "cat-supreme": 189 });
  assert.equal(result.groups[0].items[0].price, null);
  assert.equal(result.groups[0].conditional_configuration, undefined);
});

test("reviewed accessory mapping preserves modular quantity scaling", () => {
  const source = draft("choose_multiple", 0, null);
  source.optionGroups[0].conditionalConfiguration = { role: "companion", selection: "choose_multiple", applicability: [{ target: { kind: "modular", group_id: "oxi", row_id: "starter" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true }] };
  const mapped = mapDraftOptionGroupsToAccessories(source, createSmartSetupReviewRouting(source));
  assert.equal(mapped.groups[0].conditional_configuration?.applicability[0].scale_with_target_quantity, true);
  assert.equal(mapDraftOptionGroupsToAccessories(source).groups[0].conditional_configuration?.applicability[0].scale_with_target_quantity, true);
});

test("structural option roles and option-item companion targets survive adapter mapping", () => {
  const source = draft("choose_multiple", 0, null);
  source.optionGroups[0].items[0] = { ...source.optionGroups[0].items[0], role: "structural_support" };
  source.optionGroups[0].conditionalConfiguration = { role: "companion", selection: "choose_multiple", applicability: [{ target: { kind: "option_item", group_id: "supports", row_id: "support-1" }, required: true, visible: true, fixed_quantity: 2 }] };
  const mapped = mapDraftOptionGroupsToAccessories(source).groups[0];
  assert.equal(mapped.items[0].role, "structural_support");
  assert.deepEqual(mapped.conditional_configuration?.applicability[0].target, { kind: "option_item", group_id: "supports", row_id: "support-1" });
});

test("compatibleTargets maps to persisted accessory item only for structural-support items", () => {
  const source = draft("choose_multiple", 0, null);
  source.optionGroups[0].items[0] = {
    ...source.optionGroups[0].items[0],
    role: "structural_support",
    compatibleTargets: [{ kind: "base_model_subgroup", group_id: "grp-1", row_id: "sub-desk" }],
  };
  const mapped = mapDraftOptionGroupsToAccessories(source).groups[0];
  assert.equal(mapped.items[0].role, "structural_support");
  assert.deepEqual(mapped.items[0].compatible_targets, [{ kind: "base_model_subgroup", group_id: "grp-1", row_id: "sub-desk" }]);
  assert.equal("compatible_targets" in mapped.items[1], false);
  assert.equal(mapped.items[0].price, source.optionGroups[0].items[0].price);
  assert.equal(mapped.items[0].supplier_price_list_code, "STD");
});
