import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductAccessorySelection, parseSubmittedAccessoryQuantities } from "./product-accessory-configuration.js";

const topItems = [{ id: "top", price: 20 }, { id: "top-alt", price: 0 }];
const group = (id: string, role: string, rows: string[]) => ({
  id,
  group_name: id === "service" ? "Service Unit" : "Top Access",
  group_is_required: false,
  items: id === "service" ? [{ id: "service-unit", price: 50 }] : topItems,
  conditional_configuration: {
    role,
    selection: "exactly_one",
    applicability: rows.map((row) => ({ base_model_group_id: "desks", base_model_row_id: row, required: true, visible: true })),
  },
});
const top = group("top-group", "conditional_option", ["1AF003", "1AF007"]);
const service = group("service", "companion", ["1AF005", "1AF007"]);
const legacy = { id: "legacy", group_name: "Accessories", group_is_required: false, items: [{ id: "modesty", price: 10 }] };
const evaluate = (row: string, quantities: Record<string, number> = {}) => evaluateProductAccessorySelection({ accessoryGroups: [top, service, legacy], baseModelGroupId: "desks", baseModelRowId: row, selectedQuantities: quantities });

test("MONOLITH visibility and legacy accessories resolve together", () => {
  assert.deepEqual(evaluate("1AF001").groups.map((group) => [group.groupId, group.visible]), [["top-group", false], ["service", false], ["legacy", true]]);
  assert.deepEqual(evaluate("1AF003").groups.map((group) => [group.visible, group.required]), [[true, true], [false, false], [true, false]]);
  assert.deepEqual(evaluate("1AF005").groups.map((group) => [group.visible, group.required]), [[false, false], [true, true], [true, false]]);
  assert.deepEqual(evaluate("1AF007").groups.map((group) => [group.visible, group.required]), [[true, true], [true, true], [true, false]]);
});

test("exactly-one cardinality blocks invalid submissions", () => {
  assert.equal(evaluate("1AF003").valid, false);
  assert.equal(evaluate("1AF003", { top: 1 }).valid, true);
  assert.equal(evaluate("1AF003", { top: 1, "top-alt": 1 }).valid, false);
  assert.equal(evaluate("1AF003", { top: 2 }).valid, false);
});

test("model changes reconcile hidden selections and preserve eligible ones", () => {
  const selected = { top: 1, "service-unit": 1, modesty: 2 };
  assert.deepEqual(evaluate("1AF001", selected).activeQuantities, { modesty: 2 });
  assert.deepEqual(evaluate("1AF003", selected).activeQuantities, { top: 1, modesty: 2 });
});

test("allowed subsets and unknown items are rejected", () => {
  const restricted = { ...top, conditional_configuration: { ...top.conditional_configuration, applicability: [{ ...top.conditional_configuration.applicability[0], allowed_item_ids: ["top-alt"] }] } };
  const result = evaluateProductAccessorySelection({ accessoryGroups: [restricted], baseModelGroupId: "desks", baseModelRowId: "1AF003", selectedQuantities: { top: 1, unknown: 1 } });
  assert.deepEqual(result.groups[0].allowedItemIds, ["top-alt"]);
  assert.equal(result.groups[0].validationCode, "stale_selection");
  assert.deepEqual(result.unknownItemIds, ["unknown"]);
  assert.deepEqual(result.activeQuantities, {});
  assert.equal(result.valid, false);
});

test("supplier codes and prices are not rule identity or client authority", () => {
  const changed = { ...top, items: topItems.map((item) => ({ ...item, supplier_price_list_code: "CHANGED", price: 999 })) };
  const result = evaluateProductAccessorySelection({ accessoryGroups: [changed], baseModelGroupId: "desks", baseModelRowId: "1AF003", selectedQuantities: { top: 1 } });
  assert.equal(result.valid, true);
  assert.deepEqual(result.activeQuantities, { top: 1 });
});

test("Category / Matrix model targets drive authoritative Product Library accessory evaluation", () => {
  const matrixGroup = {
    id: "coat-hanger",
    group_name: "Coat Hanger",
    group_is_required: false,
    items: [{ id: "black", price: 20 }, { id: "white", price: 25 }],
    conditional_configuration: {
      role: "companion",
      selection: "at_least_one",
      applicability: [{ target: { kind: "price_matrix", group_id: "everyis1", row_id: "ev111" }, required: true, visible: true, allowed_item_ids: ["black", "white"], fixed_quantity: 1 }],
    },
  };
  const target = { kind: "price_matrix" as const, group_id: "everyis1", row_id: "ev111" };
  const missing = evaluateProductAccessorySelection({ accessoryGroups: [matrixGroup], selectedModelTarget: target });
  assert.equal(missing.groups[0].visible, true);
  assert.equal(missing.groups[0].validationCode, "required_selection_missing");
  assert.equal(evaluateProductAccessorySelection({ accessoryGroups: [matrixGroup], selectedModelTarget: target, selectedQuantities: { black: 1 } }).valid, true);
  assert.equal(evaluateProductAccessorySelection({ accessoryGroups: [matrixGroup], selectedModelTarget: { ...target, row_id: "ev711" } }).groups[0].visible, false);
});

test("server quantity input accepts only unique positive whole numbers", () => {
  assert.deepEqual(parseSubmittedAccessoryQuantities(["top:1", "top-alt:2"]), { errors: [], quantities: { top: 1, "top-alt": 2 } });
  for (const values of [["top:0"], ["top:-1"], ["top:1.5"], ["top:nope"], ["top:1:extra"], ["unknown"], ["top:1", "top:2"]]) {
    assert.equal(parseSubmittedAccessoryQuantities(values).errors.length > 0, true);
  }
});
