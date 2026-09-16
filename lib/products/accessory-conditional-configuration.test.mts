import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAccessoryConfigurationForModel,
  parseAccessoryConfigurationGroups,
  resolveAccessoryApplicabilityTarget,
  serializeAccessoryConfigurationGroups,
} from "./accessory-conditional-configuration.js";

const items = [
  { id: "standard", item_name: "Standard", supplier_price_list_code: "STD", price: null, specification: "Standard top access" },
  { id: "schuko", item_name: "Schuko", supplier_price_list_code: "SCH", price: 0, specification: "Schuko top access" },
  { id: "british", item_name: "British", supplier_price_list_code: "UK", price: 25, specification: "British top access" },
];

const rule = (row: string, overrides: Record<string, unknown> = {}) => ({
  base_model_group_id: "desks",
  base_model_row_id: row,
  required: true,
  visible: true,
  ...overrides,
});

const group = (id: string, role: string, applicability: Array<Record<string, unknown>>, selection = "exactly_one") => ({
  id,
  group_name: id === "top" ? "Top Access" : "Service Unit",
  group_is_required: false,
  is_active: true,
  sort_order: 0,
  items,
  conditional_configuration: { role, selection, applicability },
});

function evaluate(groups: unknown, row: string, selections: Record<string, Record<string, number>> = {}, baseModelGroupId = "desks") {
  return evaluateAccessoryConfigurationForModel({ accessoryGroups: groups, baseModelGroupId, baseModelRowId: row, selectedQuantitiesByGroupId: selections });
}

test("canonical accessory subgroups round-trip without changing item or conditional identity", () => {
  const source = { ...group("service", "companion", [rule("desk")]), subgroups: [{ id: "length-123", subgroup_name: "L 123.6", sort_order: 3, is_active: true, row_ids: ["standard"] }] };
  const parsed = parseAccessoryConfigurationGroups([source]);
  assert.equal(parsed.valid, true);
  assert.deepEqual(serializeAccessoryConfigurationGroups(parsed.groups)[0].subgroups, source.subgroups);
  assert.equal(parsed.groups[0].items?.[0].id, "standard");
  assert.deepEqual(parsed.groups[0].conditional_configuration, source.conditional_configuration);
});

test("an accessory item can belong to at most one subgroup while ungrouped remains valid", () => {
  const duplicate = { ...group("service", "accessory", []), subgroups: [{ id: "a", subgroup_name: "A", sort_order: 0, is_active: true, row_ids: ["standard"] }, { id: "b", subgroup_name: "B", sort_order: 1, is_active: true, row_ids: ["standard"] }] };
  assert.equal(parseAccessoryConfigurationGroups([duplicate]).issues.some((issue) => issue.code === "duplicate_subgroup_member"), true);
  assert.equal(parseAccessoryConfigurationGroups([{ ...duplicate, subgroups: duplicate.subgroups.slice(0, 1) }]).valid, true);
});

test("legacy optional and required groups preserve existing behavior", () => {
  const optional = { id: "optional", group_name: "Accessories", group_is_required: false, items };
  const required = { id: "required", group_name: "Required", group_is_required: true, items };
  const result = evaluate([optional, required], "1AF001");
  assert.equal(result.groups[0].role, "accessory");
  assert.equal(result.groups[0].visible, true);
  assert.equal(result.groups[0].valid, true);
  assert.equal(result.groups[1].minSelections, 1);
  assert.equal(result.groups[1].validationCode, "required_selection_missing");
  assert.equal(evaluate([required], "1AF001", { required: { standard: 2 } }).valid, true);
  const flatLegacy = [{ id: "flat", item_name: "Legacy accessory", price: 10 }];
  const flatResult = evaluate(flatLegacy, "1AF001", { accessories: { flat: 1 } });
  assert.equal(flatResult.groups[0].groupId, "accessories");
  assert.equal(flatResult.valid, true);
});

test("all configuration roles parse", () => {
  for (const role of ["accessory", "conditional_option", "companion"]) {
    const result = parseAccessoryConfigurationGroups([group(role, role, [])]);
    assert.equal(result.valid, true);
    assert.equal(result.groups[0].conditional_configuration?.role, role);
  }
});

test("MONOLITH model rules resolve required groups", () => {
  const top = group("top", "conditional_option", [rule("1AF003"), rule("1AF007")]);
  const service = group("service", "companion", [rule("1AF005"), rule("1AF007")]);
  const model001 = evaluate([top, service], "1AF001");
  assert.deepEqual(model001.groups.map((item) => [item.visible, item.required]), [[false, false], [false, false]]);
  const model003 = evaluate([top, service], "1AF003");
  assert.deepEqual(model003.groups.map((item) => [item.visible, item.required, item.maxSelections]), [[true, true, 1], [false, false, 1]]);
  const model005 = evaluate([top, service], "1AF005");
  assert.deepEqual(model005.groups.map((item) => [item.visible, item.required]), [[false, false], [true, true]]);
  const model007 = evaluate([top, service], "1AF007");
  assert.deepEqual(model007.groups.map((item) => [item.visible, item.required]), [[true, true], [true, true]]);
  assert.equal(model007.blockingRequirements.length, 2);
});

test("conditional and companion groups without a model rule are not applicable", () => {
  assert.equal(evaluate([group("top", "conditional_option", [])], "1AF003").groups[0].visible, false);
  assert.equal(evaluate([group("service", "companion", [])], "1AF003").groups[0].visible, false);
  assert.equal(evaluate([group("accessory", "accessory", [])], "1AF003").groups[0].visible, true);
});

test("exactly-one enforces one eligible item and one physical unit", () => {
  const top = group("top", "conditional_option", [rule("1AF003")]);
  assert.equal(evaluate([top], "1AF003").valid, false);
  assert.equal(evaluate([top], "1AF003", { top: { standard: 1 } }).valid, true);
  assert.equal(evaluate([top], "1AF003", { top: { standard: 1, schuko: 1 } }).groups[0].validationCode, "too_many_selections");
  assert.equal(evaluate([top], "1AF003", { top: { standard: 2 } }).groups[0].validationCode, "invalid_exact_quantity");
});

test("at-least-one and optional semantics remain deterministic", () => {
  const required = group("required", "conditional_option", [rule("model")], "at_least_one");
  const optional = group("optional", "accessory", [], "choose_multiple");
  assert.equal(evaluate([required], "model").valid, false);
  assert.equal(evaluate([required], "model", { required: { standard: 2 } }).valid, true);
  assert.equal(evaluate([optional], "model").valid, true);
});

test("allowed items filter and stale selections are reported", () => {
  const top = group("top", "conditional_option", [rule("model", { allowed_item_ids: ["standard", "schuko"] })]);
  assert.deepEqual(evaluate([top], "model").groups[0].allowedItemIds, ["standard", "schuko"]);
  assert.equal(evaluate([top], "model", { top: { british: 1 } }).groups[0].validationCode, "stale_selection");
  const all = group("all", "conditional_option", [rule("model")]);
  assert.deepEqual(evaluate([all], "model").groups[0].allowedItemIds, ["standard", "schuko", "british"]);
  assert.equal(evaluate([top], "other").groups[0].visible, false);
});

test("identity matches Base/Model group and row only", () => {
  const top = group("top", "conditional_option", [rule("same-row")]);
  assert.equal(evaluate([top], "same-row", {}, "desks").groups[0].visible, true);
  assert.equal(evaluate([top], "same-row", {}, "other-group").groups[0].visible, false);
  const changedCodes = { ...top, items: items.map((item) => ({ ...item, supplier_price_list_code: `NEW-${item.id}` })) };
  assert.equal(evaluate([changedCodes], "same-row").groups[0].visible, true);
});

test("price-matrix targets parse and resolve by stable group and row IDs", () => {
  const target = { kind: "price_matrix", group_id: "everyis1", row_id: "ev111" } as const;
  const coatHanger = group("coat-hanger", "conditional_option", [{ target, required: false, visible: true }], "choose_multiple");
  const parsed = parseAccessoryConfigurationGroups([coatHanger]);
  assert.equal(parsed.valid, true);
  assert.deepEqual(resolveAccessoryApplicabilityTarget(parsed.groups[0].conditional_configuration!.applicability[0]), target);
  assert.equal(evaluateAccessoryConfigurationForModel({ accessoryGroups: [coatHanger], baseModelGroupId: null, baseModelRowId: null, selectedModelTarget: target }).groups[0].visible, true);
  assert.equal(evaluateAccessoryConfigurationForModel({ accessoryGroups: [coatHanger], baseModelGroupId: null, baseModelRowId: null, selectedModelTarget: { ...target, row_id: "ev711" } }).groups[0].visible, false);
});

test("modular targets parse, serialize, and activate only for selected modular rows", () => {
  const left = { kind: "modular", group_id: "avana-large", row_id: "left" } as const;
  const feet = group("feet", "companion", [{ target: left, required: true, visible: true, allowed_item_ids: ["standard"], fixed_quantity: 1 }]);
  const parsed = parseAccessoryConfigurationGroups([feet]);
  assert.equal(parsed.valid, true);
  assert.deepEqual(resolveAccessoryApplicabilityTarget(parsed.groups[0].conditional_configuration!.applicability[0]), left);
  assert.deepEqual(serializeAccessoryConfigurationGroups(parsed.groups), [feet]);
  const unselected = evaluateAccessoryConfigurationForModel({ accessoryGroups: [feet], baseModelGroupId: null, baseModelRowId: null, selectedModelTargets: [] });
  assert.equal(unselected.groups[0].visible, false);
  const selected = (quantities: Record<string, number> = {}) => evaluateAccessoryConfigurationForModel({ accessoryGroups: [feet], baseModelGroupId: null, baseModelRowId: null, selectedModelTargets: [left], selectedQuantitiesByGroupId: { feet: quantities } });
  assert.equal(selected().groups[0].validationCode, "required_selection_missing");
  assert.equal(selected({ standard: 1 }).valid, true);
});

test("multiple selected modular rows union options and preserve every required rule without multiplying fixed quantity", () => {
  const left = { kind: "modular", group_id: "avana", row_id: "left" } as const;
  const centre = { kind: "modular", group_id: "avana", row_id: "centre" } as const;
  const rules = [
    { target: left, required: true, visible: true, allowed_item_ids: ["standard"], fixed_quantity: 1 },
    { target: centre, required: true, visible: true, allowed_item_ids: ["standard"], fixed_quantity: 1 },
  ];
  const feet = group("feet", "companion", rules);
  const result = evaluateAccessoryConfigurationForModel({ accessoryGroups: [feet], baseModelGroupId: null, baseModelRowId: null, selectedModelTargets: [left, centre], selectedQuantitiesByGroupId: { feet: { standard: 1 } } });
  assert.equal(result.valid, true);
  assert.equal(result.groups[0].fixedQuantity, 1);
  const conflicting = group("feet", "companion", [{ ...rules[0] }, { ...rules[1], allowed_item_ids: ["schuko"] }]);
  assert.equal(evaluateAccessoryConfigurationForModel({ accessoryGroups: [conflicting], baseModelGroupId: null, baseModelRowId: null, selectedModelTargets: [left, centre] }).groups[0].validationCode, "conflicting_required_rules");
});

test("price-matrix targets preserve required, allowed-items, all-items, and fixed-quantity behavior", () => {
  const target = { kind: "price_matrix", group_id: "everyis1", row_id: "ev111" } as const;
  const restricted = group("coat-hanger", "companion", [{ target, required: true, visible: true, allowed_item_ids: ["standard", "schuko"], fixed_quantity: 2 }], "choose_multiple");
  const selected = (quantities: Record<string, number>) => evaluateAccessoryConfigurationForModel({ accessoryGroups: [restricted], baseModelGroupId: null, baseModelRowId: null, selectedModelTarget: target, selectedQuantitiesByGroupId: { "coat-hanger": quantities } });
  assert.deepEqual(selected({}).groups[0].allowedItemIds, ["standard", "schuko"]);
  assert.equal(selected({ standard: 1 }).groups[0].validationCode, "fixed_quantity_mismatch");
  assert.equal(selected({ standard: 2 }).valid, true);
  const all = group("all", "conditional_option", [{ target, required: false, visible: true }], "choose_multiple");
  assert.deepEqual(evaluateAccessoryConfigurationForModel({ accessoryGroups: [all], baseModelGroupId: null, baseModelRowId: null, selectedModelTarget: target }).groups[0].allowedItemIds, items.map((item) => item.id));
});

test("workstation targets enforce companions, compatibility, and fixed quantity", () => {
  const target = { kind: "workstation", group_id: "oxi", row_id: "oxi-4" } as const;
  const legs = group("legs", "companion", [{ target, required: true, visible: true, allowed_item_ids: ["standard"], fixed_quantity: 2 }], "choose_multiple");
  const evaluateWorkstation = (selectedModelTarget: { kind: "workstation"; group_id: string; row_id: string }, quantity: number) => evaluateAccessoryConfigurationForModel({
    accessoryGroups: [legs],
    baseModelGroupId: null,
    baseModelRowId: null,
    selectedModelTarget,
    selectedQuantitiesByGroupId: { legs: { standard: quantity } },
  });
  assert.equal(parseAccessoryConfigurationGroups([legs]).valid, true);
  assert.equal(evaluateWorkstation(target, 0).groups[0].validationCode, "required_selection_missing");
  assert.equal(evaluateWorkstation(target, 1).groups[0].validationCode, "fixed_quantity_mismatch");
  assert.equal(evaluateWorkstation(target, 2).valid, true);
  const incompatible = evaluateWorkstation({ ...target, row_id: "oxi-6" }, 2);
  assert.equal(incompatible.groups[0].visible, false);
  assert.deepEqual(incompatible.groups[0].staleItemIds, ["standard"]);
});

test("invalid price-matrix targets fail safely", () => {
  const invalid = group("coat-hanger", "conditional_option", [{ target: { kind: "price_matrix", group_id: "everyis1", row_id: "" }, required: false, visible: true }]);
  const parsed = parseAccessoryConfigurationGroups([invalid]);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.issues.some((issue) => issue.code === "missing_applicability_target_row_id"), true);
});

test("malformed metadata is reported without crashing", () => {
  const duplicateRules = group("top", "conditional_option", [rule("model"), rule("model")]);
  assert.equal(parseAccessoryConfigurationGroups([duplicateRules]).issues.some((issue) => issue.code === "duplicate_applicability_rule"), true);
  assert.equal(parseAccessoryConfigurationGroups([group("top", "conditional_option", [], "bad")]).issues.some((issue) => issue.code === "invalid_cardinality"), true);
  assert.equal(parseAccessoryConfigurationGroups([group("top", "conditional_option", [rule("model", { fixed_quantity: 0 })])]).issues.some((issue) => issue.code === "invalid_fixed_quantity"), true);
  assert.equal(parseAccessoryConfigurationGroups([group("top", "conditional_option", [rule("model", { allowed_item_ids: ["standard", "standard"] })])]).issues.some((issue) => issue.code === "duplicate_allowed_item_id"), true);
  assert.equal(parseAccessoryConfigurationGroups([group("top", "unknown", [])]).issues.some((issue) => issue.code === "unknown_role"), true);
  assert.equal(parseAccessoryConfigurationGroups([{ ...group("top", "companion", []), id: "" }]).issues.some((issue) => issue.code === "missing_group_id"), true);
  assert.equal(parseAccessoryConfigurationGroups([group("top", "companion", [{ ...rule("model"), base_model_row_id: "" }])]).issues.some((issue) => issue.code === "missing_base_model_row_id"), true);
});

test("fixed quantity is enforced", () => {
  const companion = group("service", "companion", [rule("model", { fixed_quantity: 2 })], "choose_multiple");
  assert.equal(evaluate([companion], "model", { service: { standard: 1 } }).groups[0].validationCode, "fixed_quantity_mismatch");
  assert.equal(evaluate([companion], "model", { service: { standard: 2 } }).valid, true);
});

test("valid groups round-trip existing fields and preserve null versus zero", () => {
  const original = [group("top", "conditional_option", [rule("model", { allowed_item_ids: ["standard", "schuko"] })])];
  const parsed = parseAccessoryConfigurationGroups(original);
  assert.equal(parsed.valid, true);
  const serialized = serializeAccessoryConfigurationGroups(parsed.groups);
  assert.deepEqual(serialized, original);
  assert.equal(serialized[0].items?.[0].price, null);
  assert.equal(serialized[0].items?.[1].price, 0);
  assert.equal(serialized[0].items?.[0].supplier_price_list_code, "STD");
  assert.equal(serialized[0].items?.[0].specification, "Standard top access");
});
