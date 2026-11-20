import assert from "node:assert/strict";
import test from "node:test";
import { describeRecipe } from "../gallery/gallery-detail";
import { priceRecipe, type GalleryPriceTemplate } from "../gallery/gallery-price";
import { modularAlternativeSelected, evaluateSetup, type SetupTemplateInput } from "./replay";
import { buildRecipe } from "./recipe";

// Oxi_Q-like: four modular groups that are ALTERNATIVES, a legacy Base / Model group, modular-scoped accessories.
const ID = "b94d80a2-3c94-4fcc-b3a5-bb716b3057b3";
const row = (id: string, price: number, role = "starter") => ({ id, price, prices: {}, currency: "EUR", is_active: true, sort_order: 0, display_name: id, variant_name: id, dimension: "W:1800 D:800 H:736 mm", modular_role: role, pricing_type: "modular_item", unavailable_categories: [] });
const group = (id: string, family: string, items: unknown[], sort: number) => ({ id, group_name: id, is_active: true, sort_order: sort, pricing_type: "modular_group", price_categories: [], modular_composition: { min_starters: 1, max_starters: 1 }, modular_pricing_mode: "direct", modular_selection_family: family, items });
const item = (id: string, price: number) => ({ id, price, currency: "EUR", is_active: true, item_name: id, sort_order: 0 });
const target = (group_id: string, row_id: string, allowed?: string[]) => ({ target: { kind: "modular", group_id, row_id }, visible: true, required: false, ...(allowed ? { allowed_item_ids: allowed } : {}) });
const modularGroups = [
  group("oxi-q-desk-70", "desk", [row("oxi-q-desk-70-a-601", 329)], 0),
  group("oxi-q-desk-80", "desk", [row("oxi-q-desk-80-a-613", 339), row("oxi-q-desk-80-a-617", 411)], 1),
  group("oxi-q-bench-145", "bench", [row("oxi-q-bench-145-a-625", 500)], 2),
  group("oxi-q-bench-165", "bench", [row("oxi-q-bench-165-a-741", 565)], 3),
];
const accessories = [
  { id: "oxi-q-desk-extension", group_name: "Desk Extension", is_active: true, sort_order: 0, group_is_required: false, items: [item("oxi-q-ext-111612", 230)],
    conditional_configuration: { role: "accessory", selection: "unrestricted", applicability: [target("oxi-q-desk-80", "oxi-q-desk-80-a-617")] } },
  { id: "oxi-q-desk-cable-tray", group_name: "Cable Tray for Desk", is_active: true, sort_order: 1, group_is_required: false, items: [item("oxi-q-desk-tray-323", 29), item("oxi-q-desk-tray-328", 40)],
    conditional_configuration: { role: "accessory", selection: "unrestricted", applicability: [target("oxi-q-desk-80", "oxi-q-desk-80-a-617", ["oxi-q-desk-tray-328", "oxi-q-desk-tray-323"])] } },
  { id: "oxi-q-modesty-panels", group_name: "Modesty Panels", is_active: true, sort_order: 2, group_is_required: false, items: [item("oxi-q-panel-449", 30)],
    conditional_configuration: { role: "accessory", selection: "unrestricted", applicability: [target("oxi-q-desk-80", "oxi-q-desk-80-a-617", ["oxi-q-panel-449"])] } },
];
const baseModel = [{ id: "legacy-base-model-main", group_name: "Base / Model Pricing", is_active: true, sort_order: 0, pricing_type: "base_model_group",
  items: [{ ...item("oxi-q-desk-60-599", 340), variant_name: "Desk 60", display_name: "Desk 60" }] }];
const oxi: GalleryPriceTemplate & SetupTemplateInput = {
  id: ID, template_name: "Oxi_Q", currency: "AED", default_unit_price: 0, is_active: true, lifecycle_status: "active",
  variant_pricing: baseModel, category_pricing: modularGroups, accessory_pricing: accessories, desking_size_pricing: [],
} as never;
const saved = (state: Record<string, unknown>) => buildRecipe({ templateId: ID, ...state } as never).recipe;
const desk80 = { oxi: { "oxi-q-desk-80-a-617": 1 } };
const withAccessories = { "oxi-q-panel-449": 1, "oxi-q-ext-111612": 1, "oxi-q-desk-tray-328": 1 };
const replay = (template: SetupTemplateInput, recipe: ReturnType<typeof saved>) =>
  evaluateSetup(recipe, null, template, { componentIds: [], linkedFamilyIds: [], materialIds: [] }).validation.problems;

test("one modular group selected: the other modular groups are not required (replay, price, popup)", () => {
  const recipe = saved({ categoryGroupId: "oxi-q-desk-70", modularQuantities: desk80.oxi, pricingAccessoryQuantities: withAccessories });
  assert.deepEqual(replay(oxi, recipe), []);
  const price = priceRecipe(oxi, recipe);
  assert.equal(price.status, "priced");
  assert.deepEqual(price.status === "priced" ? price.sourceTotals : null, [{ currency: "EUR", amount: 411 + 230 + 40 + 30 }]);
  const detail = describeRecipe({ recipe: { ...recipe, template_id: ID }, template: oxi as never, components: [], linkedFamilies: [] });
  assert.ok(detail.dimension, "the popup treats the recipe as complete (not blocked by the empty modular groups)");
});

test("no modular item and no Base / Model: modular groups stay required", () => {
  const recipe = saved({ pricingAccessoryQuantities: {} });
  assert.deepEqual(replay(oxi, recipe).map((problem) => problem.kind), ["required_step"]);
  assert.equal(priceRecipe(oxi, recipe).status, "needs_configure");
  const detail = describeRecipe({ recipe: { ...recipe, template_id: ID }, template: oxi as never, components: [], linkedFamilies: [] });
  assert.equal(detail.dimension, null);
});

test("Base / Model selected: unchanged (modular groups ignored, line prices from the model)", () => {
  const recipe = saved({ variantRowId: "oxi-q-desk-60-599", variantGroupId: "legacy-base-model-main" });
  assert.deepEqual(replay(oxi, recipe), []);
  assert.deepEqual(priceRecipe(oxi, recipe), { status: "priced", sourceTotals: [{ currency: "EUR", amount: 340 }] });
});

test("Price Matrix selected: unchanged", () => {
  const matrix = [{ id: "cg", group_name: "Fabric", is_active: true, sort_order: 0, price_categories: ["Cat A"],
    items: [{ id: "crow", display_name: "Shell", prices: { "Cat A": 400 }, currency: "EUR", is_active: true, sort_order: 0 }] }];
  const template = { ...oxi, variant_pricing: [], category_pricing: [...modularGroups, ...matrix] } as GalleryPriceTemplate & SetupTemplateInput;
  const recipe = saved({ categoryGroupId: "cg", categoryRowId: "crow", fabricCategory: "Cat A" });
  assert.deepEqual(replay(template, recipe), []);
  assert.deepEqual(priceRecipe(template, recipe), { status: "priced", sourceTotals: [{ currency: "EUR", amount: 400 }] });
});

test("modular selected plus an accessory that does not apply: accessory rules unchanged", () => {
  const recipe = saved({ modularQuantities: desk80.oxi, pricingAccessoryQuantities: { "oxi-q-desk-tray-324": 1 } });
  assert.ok(replay(oxi, recipe).some((problem) => problem.kind === "accessory_removed"));
  assert.equal(priceRecipe(oxi, recipe).status, "needs_configure");
});

test("shared helper: true only when a modular step is resolved", () => {
  assert.equal(modularAlternativeSelected([{ kind: "modular", resolved: false }, { kind: "modular", resolved: true }]), true);
  assert.equal(modularAlternativeSelected([{ kind: "modular", resolved: false }, { kind: "accessory", resolved: true }]), false);
});
