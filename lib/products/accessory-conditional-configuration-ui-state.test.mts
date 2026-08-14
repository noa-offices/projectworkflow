import assert from "node:assert/strict";
import test from "node:test";
import { parseAccessoryPricingJson } from "./accessory-pricing-parser.js";
import { BASE_MODEL_GROUP_PRICING_TYPE } from "./base-model-pricing-groups.js";
import {
  addAccessoryApplicabilityRule,
  removeAccessoryApplicabilityRule,
  setAccessoryApplicabilityTargets,
  setAccessoryConditionalEnabled,
  setAccessoryConfigurationRole,
  setAccessoryRuleAllowedItems,
  setAccessorySelectionMode,
  staleAccessoryRuleItemIds,
  updateAccessoryApplicabilityRule,
} from "./accessory-conditional-configuration-ui-state.js";

const legacy = { id: "accessories", group_name: "Accessories", group_is_required: true, items: [{ id: "item-a", item_name: "Item A", price: null }, { id: "item-b", item_name: "Item B", price: 0 }] };

test("legacy state is unchanged until conditional configuration is enabled", () => {
  assert.equal(setAccessoryConditionalEnabled(legacy, false), legacy);
  assert.equal("conditional_configuration" in setAccessoryConditionalEnabled(legacy, false), false);
  assert.equal(setAccessoryConditionalEnabled(legacy, true).group_is_required, true);
});

test("roles and selection modes map to the C1 contract", () => {
  let group = setAccessoryConditionalEnabled(legacy, true);
  for (const role of ["accessory", "conditional_option", "companion"] as const) {
    group = setAccessoryConfigurationRole(group, role);
    assert.equal(group.conditional_configuration?.role, role);
  }
  group = setAccessorySelectionMode(group, "exactly_one");
  assert.equal(group.conditional_configuration?.selection, "exactly_one");
  group = { ...group, group_name: "Renamed", items: group.items?.map((item) => ({ ...item, item_name: "Edited" })) };
  assert.equal(group.conditional_configuration?.role, "companion");
});

test("model rules use stable IDs, prevent duplicates, update, and remove independently", () => {
  let group = setAccessoryConditionalEnabled(legacy, true);
  group = addAccessoryApplicabilityRule(group, "base-group", "model-a");
  group = addAccessoryApplicabilityRule(group, "base-group", "model-a");
  group = addAccessoryApplicabilityRule(group, "base-group", "model-b");
  assert.equal(group.conditional_configuration?.applicability.length, 2);
  group = updateAccessoryApplicabilityRule(group, 0, { required: true, fixed_quantity: 1 });
  assert.deepEqual(group.conditional_configuration?.applicability[0], { base_model_group_id: "base-group", base_model_row_id: "model-a", required: true, visible: true, fixed_quantity: 1 });
  group = removeAccessoryApplicabilityRule(group, 0);
  assert.equal(group.conditional_configuration?.applicability[0].base_model_row_id, "model-b");
});

test("multi-select targets preserve retained rules, author matrix targets, and keep unavailable rules", () => {
  const choices = [
    { key: "base_model\u0000base\u0000a", kind: "base_model" as const, groupId: "base", rowId: "a", groupLabel: "Desks", code: "A", displayName: "Desk A" },
    { key: "price_matrix\u0000matrix\u0000m", kind: "price_matrix" as const, groupId: "matrix", rowId: "m", groupLabel: "Seating", code: "M", displayName: "Chair M" },
  ];
  let group = addAccessoryApplicabilityRule(setAccessoryConditionalEnabled(legacy, true), "base", "a");
  group = updateAccessoryApplicabilityRule(group, 0, { required: true, allowed_item_ids: ["item-a"], fixed_quantity: 1 });
  group = { ...group, conditional_configuration: { ...group.conditional_configuration!, applicability: [...group.conditional_configuration!.applicability, { target: { kind: "base_model", group_id: "missing", row_id: "row" }, required: false, visible: true }] } };
  group = setAccessoryApplicabilityTargets(group, choices, new Set(choices.map((choice) => choice.key)));
  assert.deepEqual(group.conditional_configuration?.applicability[0], { base_model_group_id: "base", base_model_row_id: "a", required: true, visible: true, allowed_item_ids: ["item-a"], fixed_quantity: 1 });
  assert.deepEqual(group.conditional_configuration?.applicability[1], { target: { kind: "base_model", group_id: "missing", row_id: "row" }, required: false, visible: true });
  assert.deepEqual(group.conditional_configuration?.applicability[2], { target: { kind: "price_matrix", group_id: "matrix", row_id: "m" }, required: false, visible: true });
  const unchanged = setAccessoryApplicabilityTargets(group, choices, new Set(choices.map((choice) => choice.key)));
  assert.deepEqual(unchanged, group);
});

test("allowed-all omits IDs while specific items and stale warnings preserve IDs", () => {
  let group = addAccessoryApplicabilityRule(setAccessoryConditionalEnabled(legacy, true), "base-group", "model-a");
  group = setAccessoryRuleAllowedItems(group, 0, ["item-a", "item-b", "item-a"]);
  assert.deepEqual(group.conditional_configuration?.applicability[0].allowed_item_ids, ["item-a", "item-b"]);
  group = { ...group, items: [{ id: "item-a", price: null }] };
  assert.deepEqual(staleAccessoryRuleItemIds(group), ["item-b"]);
  group = setAccessoryRuleAllowedItems(group, 0, null);
  assert.equal("allowed_item_ids" in (group.conditional_configuration?.applicability[0] ?? {}), false);
  assert.equal(group.items?.[0].price, null);
  assert.equal(legacy.items[1].price, 0);
});

test("conditional configuration can be removed to restore the legacy shape", () => {
  const restored = setAccessoryConditionalEnabled(setAccessoryConditionalEnabled(legacy, true), false);
  assert.deepEqual(restored, legacy);
});

test("authored rules persist through the C2 save parser", () => {
  let group = setAccessoryConditionalEnabled(legacy, true);
  group = setAccessoryConfigurationRole(group, "conditional_option");
  group = setAccessorySelectionMode(group, "exactly_one");
  group = addAccessoryApplicabilityRule(group, "base-group", "model-a");
  group = updateAccessoryApplicabilityRule(group, 0, { required: true, fixed_quantity: 1 });
  group = setAccessoryRuleAllowedItems(group, 0, ["item-a"]);
  const saved = parseAccessoryPricingJson(JSON.stringify([group]), [{
    id: "base-group",
    pricing_type: BASE_MODEL_GROUP_PRICING_TYPE,
    group_name: "Models",
    is_active: true,
    sort_order: 0,
    items: [{ id: "model-a", variant_name: "Model A", price: 100 }],
  }]);
  assert.deepEqual(saved[0].conditional_configuration, group.conditional_configuration);
});
