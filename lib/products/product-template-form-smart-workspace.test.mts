import assert from "node:assert/strict";
import test from "node:test";
import { productTemplateFormSmartWorkspace } from "./product-template-form-smart-workspace.js";

const subgroup = { id: "sub-right", subgroup_name: "Right", sort_order: 0, is_active: true, row_ids: ["model-a"] };

test("live form pricing becomes an authoritative reviewed workspace without losing edits", () => {
  const workspace = productTemplateFormSmartWorkspace({
    template_name: "Edited MONOLITH",
    template_code: "MON",
    item_code: "DESK",
    internal_selection_name: "Internal edit",
    description: "Edited description",
    default_specification: "Edited family specification",
    origin: "Italy",
    supplier_name: "LAS",
    currency: "EUR",
    desking_size_pricing: "[]",
    variant_pricing: JSON.stringify([{ id: "executive", pricing_type: "base_model_group", group_name: "Executive Desks", is_active: true, sort_order: 0, subgroups: [subgroup], items: [{ id: "model-a", variant_name: "Supplier label", display_name: "Executive Desk W210", supplier_price_list_code: "1AF 001", dimension: "W210 x D105 x H76 cm", price: 987, currency: "EUR", specification: "Reviewed row specification" }] }]),
    category_pricing: JSON.stringify([{ id: "finishes", group_name: "Finishes", price_categories: ["A", "B"], items: [{ id: "finish-a", display_name: "Wood finish", prices: { A: 0, B: null } }] }]),
    accessory_pricing: JSON.stringify([{ id: "service", group_name: "Service Units", group_is_required: true, subgroups: [{ ...subgroup, row_ids: ["service-right"] }], conditional_configuration: { role: "companion", selection: "exactly_one", applicability: [{ base_model_group_id: "executive", base_model_row_id: "model-a", required: true, visible: true, allowed_item_ids: ["service-right"], fixed_quantity: 1 }] }, items: [{ id: "service-right", item_name: "Service Unit W123.6 - Right", supplier_price_list_code: "1AF 090", price: 0, specification: "Right service unit." }] }]),
  });

  assert.equal(workspace.draft.template.templateName, "Edited MONOLITH");
  assert.equal(workspace.draft.pricing.priceMatrices[0].rows[0].prices.price, 987);
  assert.equal(workspace.draft.pricing.priceMatrices[1].rows[0].prices.A, 0);
  assert.equal(workspace.draft.pricing.priceMatrices[1].rows[0].prices.B, null);
  assert.equal(workspace.draft.optionGroups[0].items[0].displayName, "Service Unit W123.6 - Right");
  assert.deepEqual(workspace.draft.optionGroups[0].items[0].supplierCodes, ["1AF 090"]);
  assert.deepEqual(workspace.subgroups["matrix:executive"], [subgroup]);
  assert.deepEqual(workspace.subgroups["option:service"]?.[0].row_ids, ["service-right"]);
  assert.equal(workspace.plan.routes.find((route) => route.key === "matrix:executive")?.destination, "base_model");
  assert.equal(workspace.plan.routes.find((route) => route.key === "matrix:finishes")?.destination, "category_matrix");

  const accessory = workspace.plan.routes.find((route) => route.key === "option:service")?.accessory;
  assert.equal(accessory?.role, "companion");
  assert.equal(accessory?.selection, "required_exactly_one");
  assert.deepEqual(accessory?.rules[0], { baseModelGroupId: "executive", baseModelRowId: "model-a", required: true, visible: true, allowedItemIds: ["service-right"], fixedQuantity: 1 });
});

test("malformed or absent pricing JSON is isolated to empty sections", () => {
  const workspace = productTemplateFormSmartWorkspace({ variant_pricing: "not json", category_pricing: "", accessory_pricing: "{}", desking_size_pricing: "[]" });
  assert.deepEqual(workspace.draft.pricing.baseModelRows, []);
  assert.deepEqual(workspace.draft.pricing.priceMatrices, []);
  assert.deepEqual(workspace.draft.optionGroups, []);
  assert.deepEqual(workspace.plan.routes, []);
});

test("live modular hidden JSON remains available to manufacturer comparison", () => {
  const workspace = productTemplateFormSmartWorkspace({ desking_size_pricing: "[]", variant_pricing: "[]", category_pricing: "[]", accessory_pricing: "[]", modular_item_pricing: JSON.stringify([{ id: "modules", pricing_type: "modular_group", group_name: "Modules", price_categories: ["Cat A"], items: [{ id: "module-a", display_name: "Module A", supplier_price_list_code: "MOD-A", prices: { "Cat A": 12 } }] }]) });
  assert.equal(workspace.draft.pricing.modularGroups[0].id, "modules");
  assert.equal(workspace.draft.pricing.modularGroups[0].matrix!.rows[0].prices["Cat A"], 12);
});

test("saved direct Modular and scaled applicability reopen without matrix conversion", () => {
  const workspace = productTemplateFormSmartWorkspace({ desking_size_pricing: "[]", variant_pricing: "[]", category_pricing: "[]", modular_item_pricing: JSON.stringify([{ id: "oxi", pricing_type: "modular_group", modular_pricing_mode: "direct", modular_composition: { min_starters: 1, max_starters: 1 }, items: [{ id: "starter", display_name: "Starter", supplier_price_list_code: "111 065", price: 500, currency: "EUR", modular_role: "starter" }, { id: "add", display_name: "Add-on", supplier_price_list_code: "111 069", price: 300, currency: "EUR", modular_role: "intermediate" }] }]), accessory_pricing: JSON.stringify([{ id: "art-058", group_name: "ART.058", conditional_configuration: { role: "companion", selection: "choose_multiple", applicability: [{ target: { kind: "modular", group_id: "oxi", row_id: "starter" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true }] }, items: [{ id: "058", item_name: "ART.058", price: 69, currency: "EUR" }] }]) });
  const group = workspace.draft.pricing.modularGroups[0];
  assert.equal(group.pricingMode, "direct");
  assert.equal(group.matrix, undefined);
  assert.equal(group.directRows?.[0].price, 500);
  assert.equal(group.directRows?.[1].role, "intermediate");
  assert.deepEqual(group.composition, { minStarters: 1, maxStarters: 1 });
  assert.equal(workspace.plan.routes.find((route) => route.key === "option:art-058")?.accessory?.rules[0].scaleWithTargetQuantity, true);
});

test("live category-priced accessories preserve group categories and independent item price maps", () => {
  const priceCategories = [{ id: "cat-b", label: "B" }, { id: "cat-supreme", label: "SUPREME" }];
  const workspace = productTemplateFormSmartWorkspace({ desking_size_pricing: "[]", variant_pricing: "[]", category_pricing: "[]", accessory_pricing: JSON.stringify([{ id: "cushions", group_name: "Cushions", price_categories: priceCategories, items: [{ id: "958", item_name: "Cushion 958", price: null, prices: { "cat-b": 93, "cat-supreme": 162 } }, { id: "959", item_name: "Cushion 959", price: null, prices: { "cat-b": 107, "cat-supreme": 189 } }] }]) });
  assert.deepEqual(workspace.draft.optionGroups[0].priceCategories, priceCategories);
  assert.deepEqual(workspace.draft.optionGroups[0].items[0].prices, { "cat-b": 93, "cat-supreme": 162 });
  assert.deepEqual(workspace.draft.optionGroups[0].items[1].prices, { "cat-b": 107, "cat-supreme": 189 });
});

test("live workstation rows retain stable identity, layout, and important requirements", () => {
  const pricing = [{ id: "bench", pricing_type: "workstation_group", group_name: "OXI", is_active: true, sort_order: 0, items: [{ id: "oxi-4", label: "4 person bench", layout_type: "Cluster", importantRequirements: [" Required legs ", "Required legs", "Cable tray"] }] }];
  const workspace = productTemplateFormSmartWorkspace({ desking_size_pricing: JSON.stringify(pricing), variant_pricing: "[]", category_pricing: "[]", accessory_pricing: "[]" });
  assert.equal(workspace.draft.pricing.workstationRows[0].id, "oxi-4");
  assert.equal(workspace.draft.pricing.workstationRows[0].layoutType, "cluster");
  assert.deepEqual(workspace.draft.pricing.workstationRows[0].importantRequirements, ["Required legs", "Cable tray"]);
});
