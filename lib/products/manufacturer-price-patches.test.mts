import assert from "node:assert/strict";
import test from "node:test";
import type { ManufacturerPriceDifference, ManufacturerPricingType } from "./manufacturer-update-diff.js";
import { applyManufacturerPricePatches, type ManufacturerPricingFormState } from "./manufacturer-price-patches.js";

const state = (): ManufacturerPricingFormState => ({
  deskingSizePricing: [{ id: "workstations", pricing_type: "workstation_group", group_name: "Workstations", is_active: false, subgroups: [{ id: "ws-sub", subgroup_name: "Linear", sort_order: 0, is_active: true, row_ids: ["ws"] }], items: [{ id: "ws", label: "W2", default_price: null, additional_price: 0, specification: "Keep", layout_type: "linear", is_active: false }] }],
  variantPricing: [{ id: "desks", pricing_type: "base_model_group", group_name: "Desks", is_active: false, subgroups: [{ id: "desk-sub", subgroup_name: "Executive", sort_order: 0, is_active: true, row_ids: ["desk"] }], items: [{ id: "desk", display_name: "Desk", supplier_price_list_code: "1AF001", price: 100, specification: "Keep", dimension: "200 cm", is_active: false }] }],
  categoryPricing: [{ id: "finishes", group_name: "Finishes", price_categories: ["Cat A", "Cat B"], subgroups: [{ id: "finish-sub", subgroup_name: "Wood", sort_order: 0, is_active: true, row_ids: ["finish"] }], items: [{ id: "finish", prices: { "Cat A": 10, "Cat B": 20 }, specification: "Keep" }] }],
  modularPricing: [{ id: "modules", pricing_type: "modular_group", group_name: "Modules", price_categories: ["Cat A"], items: [{ id: "module", prices: { "Cat A": 30 }, specification: "Keep" }] }],
  accessoryPricing: [{ id: "service", group_name: "Service", subgroups: [{ id: "right", subgroup_name: "Right", sort_order: 0, is_active: true, row_ids: ["accessory"] }], conditional_configuration: { role: "companion", selection: "exactly_one", applicability: [{ base_model_group_id: "desks", base_model_row_id: "desk", required: true, visible: true, allowed_item_ids: ["accessory"], fixed_quantity: 1 }] }, items: [{ id: "accessory", item_name: "Service Unit", supplier_price_list_code: "1AF090", price: 40, specification: "Keep", is_active: false }] }],
});

const patch = (pricingType: ManufacturerPricingType, groupId: string, rowId: string, field: ManufacturerPriceDifference["field"], currentValue: number | null, incomingValue: number | null, columnId?: string): ManufacturerPriceDifference => ({ pricingType, groupId, groupName: groupId, rowId, subgroupId: null, subgroupName: null, displayName: rowId, supplierCode: null, field, currentValue, incomingValue, currentCurrency: "EUR", incomingCurrency: "EUR", priceChanged: currentValue !== incomingValue, currencyChanged: false, ...(columnId ? { columnId, columnLabel: columnId } : {}) });

test("selected patches update only exact price fields across all pricing types", () => {
  const current = state(); const before = structuredClone(current);
  const result = applyManufacturerPricePatches(current, [
    patch("base_model", "desks", "desk", "price", 100, 110),
    patch("workstation", "legacy-workstation-main", "ws", "default_price", null, 0),
    patch("workstation", "legacy-workstation-main", "ws", "additional_price", 0, null),
    patch("category_matrix", "finishes", "finish", "price", 10, 15, "Cat A"),
    patch("modular", "modules", "module", "price", 30, 35, "Cat A"),
    patch("accessory", "service", "accessory", "price", 40, 45),
  ]);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal((result.state.variantPricing[0].items as Array<Record<string, unknown>>)[0].price, 110);
  assert.deepEqual([(result.state.deskingSizePricing[0].items as Array<Record<string, unknown>>)[0].default_price, (result.state.deskingSizePricing[0].items as Array<Record<string, unknown>>)[0].additional_price], [0, null]);
  assert.deepEqual((result.state.categoryPricing[0].items as Array<Record<string, unknown>>)[0].prices, { "Cat A": 15, "Cat B": 20 });
  assert.deepEqual((result.state.modularPricing[0].items as Array<Record<string, unknown>>)[0].prices, { "Cat A": 35 });
  assert.equal((result.state.accessoryPricing[0].items as Array<Record<string, unknown>>)[0].price, 45);
  assert.deepEqual(current, before);
});

test("protected row, group, subgroup, and conditional metadata remain deeply equal", () => {
  const current = state(); const result = applyManufacturerPricePatches(current, [patch("accessory", "service", "accessory", "price", 40, 99)]);
  assert.equal(result.ok, true); if (!result.ok) return;
  const protectedCurrent = structuredClone(current); const protectedNext = structuredClone(result.state);
  (protectedCurrent.accessoryPricing[0].items as Array<Record<string, unknown>>)[0].price = 99;
  assert.deepEqual(protectedNext, protectedCurrent);
});

test("unselected patches change nothing and accepted subsets remain independent", () => {
  const current = state();
  const empty = applyManufacturerPricePatches(current, []); assert.deepEqual(empty.ok && empty.state, current);
  const one = applyManufacturerPricePatches(current, [patch("workstation", "legacy-workstation-main", "ws", "default_price", null, 5)]);
  assert.equal(one.ok && (one.state.deskingSizePricing[0].items as Array<Record<string, unknown>>)[0].additional_price, 0);
});

test("stale rows, missing columns, duplicate patches, and currency changes fail atomically", () => {
  const cases = [
    [patch("base_model", "desks", "missing", "price", 100, 1)],
    [patch("category_matrix", "finishes", "finish", "price", 10, 1, "Missing")],
    [patch("base_model", "desks", "desk", "price", 999, 1)],
    [patch("base_model", "desks", "desk", "price", 100, 1), patch("base_model", "desks", "desk", "price", 100, 2)],
    [{ ...patch("base_model", "desks", "desk", "price", 100, 1), currencyChanged: true }],
  ];
  cases.forEach((patches) => { const current = state(); const before = structuredClone(current); const result = applyManufacturerPricePatches(current, patches); assert.equal(result.ok, false); assert.deepEqual(current, before); });
});
