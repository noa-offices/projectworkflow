import assert from "node:assert/strict";
import test from "node:test";
import { buildRecipe, type SavedSetupPlainState } from "../saved-setups/recipe";
import { priceRecipe, type GalleryPriceTemplate } from "./gallery-price";

const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const template: GalleryPriceTemplate = { id, template_name: "Desk", currency: "EUR", default_unit_price: 1000, is_active: true, lifecycle_status: "active" };
const saved = (state: Partial<SavedSetupPlainState> = {}) => buildRecipe({ templateId: id, ...state }).recipe;
const model = (price: number) => [{ id: "g", pricing_type: "base_model_group", group_name: "Family", is_active: true, sort_order: 0, items: [
  { id: "model", variant_name: "Desk", price, is_active: true, sort_order: 0 },
] }];
const workstation = { ...template, desking_size_pricing: [{ id: "wg", pricing_type: "workstation_group", group_name: "Sizes", is_active: true, sort_order: 0, items: [
  { id: "size", label: "1800x900", default_price: 700, additional_price: 200, is_active: true, sort_order: 0 },
] }] };

test("Base / Model uses current row price, including explicit zero", () => {
  const recipe = saved({ variantRowId: "model" });
  for (const amount of [500, 625, 0]) {
    assert.deepEqual(priceRecipe({ ...template, variant_pricing: model(amount) }, recipe), {
      status: "priced", sourceTotals: [{ currency: "EUR", amount }],
    });
  }
});

test("workstation extensions are included: 700 + 2 x 200 = 1100", () => {
  const recipe = saved({ workstationSizeId: "size", additionalClusterQuantity: 2 });
  assert.deepEqual(priceRecipe(workstation, recipe), { status: "priced", sourceTotals: [{ currency: "EUR", amount: 1100 }] });
});

test("Price Matrix uses the saved category cell: Cat B = EUR 450", () => {
  const category_pricing = [{ id: "cgrp1", group_name: "Fabric", is_active: true, sort_order: 0, price_categories: ["Cat A", "Cat B"],
    items: [{ id: "shell", variant_name: "Chair Shell", prices: { "Cat A": 400, "Cat B": 450 }, is_active: true, sort_order: 0 }] }];
  assert.deepEqual(priceRecipe({ ...template, category_pricing }, saved({ categoryGroupId: "cgrp1", categoryRowId: "shell", fabricCategory: "Cat B" })),
    { status: "priced", sourceTotals: [{ currency: "EUR", amount: 450 }] });
});

const modularTemplate = { ...template, category_pricing: [{
  id: "benches", pricing_type: "modular_group", group_name: "Benches", is_active: true, sort_order: 0,
  modular_pricing_mode: "direct", modular_composition: { min_starters: 1, max_starters: 4 },
  items: [{ id: "bench", pricing_type: "modular_item", modular_role: "starter", variant_name: "OXI_P", price: 300, currency: "EUR", is_active: true, sort_order: 0 }],
}], accessory_pricing: [{
  id: "tops", group_name: "Top-Access", is_active: true, sort_order: 0,
  items: [{ id: "top", item_name: "Top-Access", price: 25, role: "companion", is_active: true, sort_order: 0 }],
  conditional_configuration: { role: "companion", selection: "choose_multiple",
    applicability: [{ target: { kind: "modular", group_id: "benches", row_id: "bench" }, required: true, visible: true, allowed_item_ids: ["top"], fixed_quantity: 2, scale_with_target_quantity: true }] },
}] };

test("OXI_P: 2 x EUR 300 plus 4 x EUR 25 required Top-Access, ignoring historical Base/Model", () => {
  const expected = { status: "priced", sourceTotals: [{ currency: "EUR", amount: 700 }] };
  assert.deepEqual(priceRecipe(modularTemplate, saved({ modularQuantities: { bench: 2 } })), expected);
  assert.deepEqual(priceRecipe({ ...modularTemplate, variant_pricing: model(900) },
    saved({ variantRowId: "legacy-model", modularQuantities: { bench: 2 } })), expected);
});

test("stale, retired and ambiguous configurations all fail closed", () => {
  assert.deepEqual(priceRecipe({ ...workstation, ...modularTemplate, desking_size_pricing: workstation.desking_size_pricing }, saved({ modularQuantities: { bench: 2 }, workstationSizeId: "size" })),
    { status: "needs_configure", reason: "ambiguous_precedence" });
  assert.equal(priceRecipe({ ...template, variant_pricing: model(500) }, saved({ variantRowId: "deleted" })).status, "needs_configure");
  assert.deepEqual(priceRecipe({ ...template, is_active: false }, saved()), { status: "needs_configure", reason: "retired_template" });
});

test("options are folded into the default base while accessory currencies are kept separate", () => {
  const option = { id: "arm", template_id: id, option_type: "component_option", qty: 2, unit_price: 15, currency: "EUR" };
  const withAccessories = { ...template, accessory_pricing: [{ id: "tray", item_name: "Cable tray", price: 12.5, currency: "USD", is_active: true }] };
  const recipe = saved({ componentOptionSelections: { Arms: "arm" }, pricingAccessoryQuantities: { tray: 2 } });
  // EUR 1000 + 2 x EUR 15, and 2 x USD 12.50.
  assert.deepEqual(priceRecipe(withAccessories, recipe, { components: [option] }),
    { status: "priced", sourceTotals: [{ currency: "EUR", amount: 1030 }, { currency: "USD", amount: 25 }] });
  assert.deepEqual(priceRecipe(withAccessories, recipe, { components: [{ ...option, currency: "USD" }] }),
    { status: "needs_configure", reason: "mixed_base_currencies" });
  assert.equal(priceRecipe(withAccessories, recipe).status, "needs_configure");
});

test("linked-product recipe charges 2 x EUR 75 and its one USD 9 accessory", () => {
  const child = { ...template, id: "child", default_unit_price: 75, accessory_pricing: [{ id: "cable", item_name: "Cable", price: 9, currency: "USD" }] };
  const links = [{ id: "link", parent_template_id: id, linked_template_id: child.id, is_required: true, allow_multiple: false, add_to_parent_price: true }];
  const recipe = saved({ linkedSelections: { "link:one": { quantity: 2, accessoryQuantities: { cable: 1 } } } });
  assert.deepEqual(priceRecipe(template, recipe, { links, linkedTemplates: new Map([[child.id, child]]) }),
    { status: "priced", sourceTotals: [{ currency: "EUR", amount: 1150 }, { currency: "USD", amount: 9 }] });
  assert.deepEqual(priceRecipe(template, recipe, { links }), { status: "needs_configure", reason: "unresolved_linked_product" });
});

test("implicit default component options use the same default selection as the quote form", () => {
  const first = { id: "arm", template_id: id, option_type: "component_option", component_group: "Arms", qty: 2, unit_price: 15, currency: "EUR", is_default_selected: true, sort_order: 1 };
  const second = { ...first, id: "arm2", qty: 1, unit_price: 10, sort_order: 2 };
  assert.deepEqual(priceRecipe(template, saved(), { components: [second, first] }),
    { status: "priced", sourceTotals: [{ currency: "EUR", amount: 1030 }] });
  assert.deepEqual(priceRecipe(template, saved({ componentOptionSelections: { "component_option:Arms": second.id } }), { components: [first, second] }),
    { status: "priced", sourceTotals: [{ currency: "EUR", amount: 1010 }] });
});

test("system quantities and base model are both charged before source-currency splitting", () => {
  const [group] = model(500);
  const variant_pricing = [{ ...group, items: [...group.items,
    { id: "system", role: "system_base", variant_name: "Steel system", price: 125, currency: "USD", is_active: true, sort_order: 1 },
  ] }];
  assert.deepEqual(priceRecipe({ ...template, variant_pricing }, saved({ variantRowId: "model", systemRowId: "system", systemQuantity: 2 })), {
    status: "priced", sourceTotals: [{ currency: "EUR", amount: 500 }, { currency: "USD", amount: 250 }],
  });
});
