import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { accessoryApplicabilityTargetKey, type AccessoryApplicabilityTarget } from "../products/accessory-conditional-configuration.js";
import { evaluateProductAccessorySelection } from "./product-accessory-configuration.js";
import { effectiveRequiredQuantities, requiredComponentOverrideReport, requiredComponentTriggerKey, withRequiredOverride, withoutRequiredOverride, type RequiredComponentOverrides } from "./required-component-overrides.js";

const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
const actions = readFileSync("app/quotations/actions.ts", "utf8");

const system = (id: string): AccessoryApplicabilityTarget => ({ kind: "base_model", group_id: "sys", row_id: id });
const groups = (rule: Record<string, unknown>) => [{
  id: "top", group_name: "Top", items: [{ id: "top-1", item_name: "Top", price: 80, is_active: true }],
  conditional_configuration: { role: "companion", selection: "at_least_one", applicability: [{ target: system("s1"), required: true, visible: true, fixed_quantity: 1, ...rule }, { target: system("s2"), required: true, visible: true, fixed_quantity: 1, ...rule }] },
}];
const evaluate = (rule: Record<string, unknown>, target: AccessoryApplicabilityTarget, quantity: number, selected: Record<string, number>, allow = true) =>
  evaluateProductAccessorySelection({
    accessoryGroups: groups(rule), selectedModelTargets: [target],
    selectedModelTargetQuantities: { [accessoryApplicabilityTargetKey(target)]: quantity },
    selectedQuantities: selected, allowRequiredCompanionOverrides: allow,
  });
const requiredGroup = (result: ReturnType<typeof evaluate>) => result.groups[0];
const trigger = (target: AccessoryApplicabilityTarget, quantity: number) => requiredComponentTriggerKey([target], { [accessoryApplicabilityTargetKey(target)]: quantity });
const effective = (rule: Record<string, unknown>, target: AccessoryApplicabilityTarget, quantity: number, overrides: RequiredComponentOverrides) =>
  effectiveRequiredQuantities(evaluate(rule, target, quantity, {}).groups, overrides, trigger(target, quantity));

const follow = { scale_with_target_quantity: true };

test("1-2, A, F: a required companion auto-selects at its derived quantity; a fixed rule ignores the System quantity", () => {
  assert.deepEqual(effective({}, system("s1"), 1, {}), { "top-1": 1 });
  assert.deepEqual(effective({}, system("s1"), 2, {}), { "top-1": 1 }, "ordinary fixed quantity is unchanged");
  assert.equal(requiredGroup(evaluate({}, system("s1"), 2, { "top-1": 1 })).overridden, false);
});

test("3, B: a Base/Model target with scale_with_target_quantity follows the System quantity (2 x 1 = 2)", () => {
  assert.deepEqual(effective(follow, system("s1"), 1, {}), { "top-1": 1 });
  assert.deepEqual(effective(follow, system("s1"), 2, {}), { "top-1": 2 });
  const group = requiredGroup(evaluate(follow, system("s1"), 2, { "top-1": 2 }));
  assert.deepEqual([group.requiredQuantity, group.selectedQuantity, group.overridden, group.valid], [2, 2, false, true]);
});

test("4-5, C, D: a required companion can be unticked or changed; it is reported as overridden, not blocked", () => {
  const changed = requiredGroup(evaluate(follow, system("s1"), 2, { "top-1": 1 }));
  assert.deepEqual([changed.requiredQuantity, changed.selectedQuantity, changed.overridden, changed.valid], [2, 1, true, true]);
  const unticked = requiredGroup(evaluate(follow, system("s1"), 2, {}));
  assert.deepEqual([unticked.selectedQuantity, unticked.overridden, unticked.valid], [0, true, true]);
  assert.deepEqual(requiredComponentOverrideReport(evaluate(follow, system("s1"), 2, { "top-1": 1 }).groups), [{ group_id: "top", required_quantity: 2, selected_quantity: 1 }]);
  // strict behavior is preserved when overrides are not allowed
  assert.equal(requiredGroup(evaluate(follow, system("s1"), 2, { "top-1": 1 }, false)).valid, false);
});

test("6-7, 10: a manual quantity or untick survives re-evaluation and unrelated accessory changes", () => {
  const t = trigger(system("s1"), 2);
  let overrides = withRequiredOverride({}, "top-1", 1, t);
  assert.deepEqual(effective(follow, system("s1"), 2, overrides), { "top-1": 1 });
  assert.deepEqual(effective(follow, system("s1"), 2, overrides), { "top-1": 1 }, "re-render");
  overrides = withRequiredOverride(overrides, "top-1", 0, t);
  assert.deepEqual(effective(follow, system("s1"), 2, overrides), { "top-1": 0 });
  // the trigger key ignores accessory quantities entirely, so unrelated accessory edits keep the override
  assert.equal(trigger(system("s1"), 2), t);
  assert.deepEqual(effective(follow, system("s1"), 2, withoutRequiredOverride(overrides, "top-1")), { "top-1": 2 }, "Reset to required");
});

test("8-9, E: a trigger change (other System, or System quantity) recalculates and drops the old override", () => {
  const overrides = withRequiredOverride({}, "top-1", 1, trigger(system("s1"), 2));
  assert.deepEqual(effective(follow, system("s2"), 2, overrides), { "top-1": 2 }, "another System does not inherit the override");
  assert.deepEqual(effective(follow, system("s1"), 3, overrides), { "top-1": 3 }, "a quantity change recalculates");
});

test("11-12: scaling stays valid for modular/option_item, Workstation/Matrix are still rejected, and other codes are still enforced", () => {
  const wrong = evaluateProductAccessorySelection({
    accessoryGroups: [{ id: "g", group_name: "G", items: [{ id: "i", item_name: "I", price: 1, is_active: true }], conditional_configuration: { role: "companion", selection: "at_least_one", applicability: [{ target: { kind: "workstation", group_id: "g", row_id: "r" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true }] } }],
    selectedModelTargets: [{ kind: "workstation", group_id: "g", row_id: "r" }],
  });
  assert.equal(wrong.valid, false);
  const modular = evaluateProductAccessorySelection({
    accessoryGroups: [{ id: "g", group_name: "G", items: [{ id: "i", item_name: "I", price: 1, is_active: true }], conditional_configuration: { role: "companion", selection: "at_least_one", applicability: [{ target: { kind: "modular", group_id: "m", row_id: "r" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true }] } }],
    selectedModelTargets: [{ kind: "modular", group_id: "m", row_id: "r" }],
    selectedModelTargetQuantities: { [accessoryApplicabilityTargetKey({ kind: "modular", group_id: "m", row_id: "r" })]: 3 },
    selectedQuantities: { i: 6 },
  });
  assert.equal(modular.valid, true);
  assert.equal(modular.groups[0].fixedQuantity, 6);
  const stale = evaluate({}, system("s1"), 1, { "unknown-item": 1 });
  assert.equal(stale.valid, false, "unknown items still block");
});

test("13: the server accepts an override, feeds the System quantity, prices from the submitted quantity and records the override", () => {
  assert.ok(actions.includes("allowRequiredCompanionOverrides: true,"));
  assert.ok(actions.includes("systemQuantity]] : [])]),"), "System quantity is the Base/Model target quantity");
  assert.ok(actions.includes("required_component_overrides: requiredComponentOverrides"));
  assert.ok(actions.includes("selectedQuantities: Object.fromEntries(submittedAccessoryPricingQtyById),"), "quantities come from the submission; prices come from the template");
  const priced = evaluate(follow, system("s1"), 2, { "top-1": 1 });
  assert.equal(priced.valid, true);
  assert.deepEqual(priced.activeQuantities, { "top-1": 1 });
  assert.equal(priced.activeQuantities["top-1"] * 80, 80, "priced at the selected (overridden) quantity, template price 80");
});

test("UI: required rows are toggleable and editable, show Required: N, the override warning and Reset to required", () => {
  const region = selector.slice(selector.indexOf("const isRequired = itemId === requiredItemId;"), selector.indexOf("Reset to required") + 40);
  assert.equal(region.includes("disabled={forced"), false);
  assert.equal(region.includes("forced"), false);
  assert.ok(selector.includes("Required by the selected configuration — manually overridden."));
  assert.ok(selector.includes("Required: {evaluation.requiredQuantity}"));
  assert.ok(selector.includes("Required component overridden"));
  assert.ok(selector.includes("requiredCompanionItems(accessoryConfiguration.groups).some((entry) => entry.itemId === itemId)"), "edits on required items go to the override map, not the shared quantity state");
});
