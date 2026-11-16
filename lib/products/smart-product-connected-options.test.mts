import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft } from "./product-template-draft.js";
import { createSmartSetupReviewRouting, validateSmartSetupReviewRouting, type SmartReviewAccessoryConfiguration } from "./smart-product-review-routing.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";
import { rebuildApplicableModelRules } from "./smart-product-option-relationships.js";
import { connectedOptionChoices, connectedOptionSettings, connectedOptionQuantityIssue, connectedOptionKey, rebuildConnectedOptionRules, setConnectedOptionSettings, optionApplicabilityText, connectedOptionIssues } from "./smart-product-connected-options.js";

const row = (id: string) => ({ id, label: id, displayName: id, supplierCodes: [`SKU-${id}`], referenceCodes: [], price: 10, currency: "EUR" as const, dimensions: null, specification: null });
function fixture(): ProductTemplateDraft {
  return {
    version: 1, template: { templateName: "Template", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: "EUR", pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] },
    optionGroups: [
      { id: "kit", label: "Kits", items: [row("kit-item")], selection: { mode: "required_choose_at_least_one", minSelections: 1, maxSelections: null, defaultItemIds: [] } },
      { id: "panels", label: "Panels", items: Array.from({ length: 5 }, (_, i) => row(`panel-${i}`)), selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] } },
    ], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
  };
}
const configuration = (): SmartReviewAccessoryConfiguration => ({ role: "companion", selection: "required_at_least_one", rules: [] });
const model = { baseModelGroupId: "models", baseModelRowId: "m", required: false, visible: true };

test("choose five and remove one: exact saved option rules, model rules and input stay intact", () => {
  const draft = fixture(), plan = createSmartSetupReviewRouting(draft);
  const choices = connectedOptionChoices(draft, plan, "kit").filter((c) => !c.disabledReason);
  const original = { ...configuration(), rules: [model] };
  const before = structuredClone(original);
  const rules = rebuildConnectedOptionRules(original, choices, new Set(choices.map((c) => c.key)));
  assert.equal(rules.length, 6);
  assert.equal(rules[0], model);
  const selected = { ...original, rules };
  plan.routes[0].accessory = { ...selected, rules: rules.slice(1) };
  const saved = mapDraftOptionGroupsToAccessories(draft, plan).groups[0];
  assert.deepEqual(saved.conditional_configuration?.applicability, choices.map((c) => ({ target: c.target, visible: true, required: true, fixed_quantity: 1, scale_with_target_quantity: true })));
  const fewer = rebuildConnectedOptionRules(selected, choices, new Set(choices.slice(1).map((c) => c.key)));
  assert.equal(fewer.length, 5);
  assert.equal(fewer[0], model);
  assert.deepEqual(original, before);
  assert.deepEqual(rebuildConnectedOptionRules(selected, choices, new Set(choices.map((c) => c.key))), rules);
});

test("mode and all four quantity choices normalise connected settings while retaining other fields", () => {
  const rule = { target: { kind: "option_item" as const, group_id: "panels", row_id: "panel-0" }, required: true, visible: false, fixedQuantity: 1, allowedItemIds: ["kit-item"], extra: "keep" };
  for (const quantity of [1, 2]) for (const scaled of [true, false]) {
    const next = setConnectedOptionSettings({ ...configuration(), rules: [model, rule] }, { required: true, quantity, scaled });
    assert.equal(next.role, "companion");
    assert.equal(next.selection, "required_at_least_one");
    assert.equal(next.rules[0], model);
    assert.deepEqual(next.rules[1], { ...rule, required: true, visible: true, fixedQuantity: quantity, scaleWithTargetQuantity: scaled });
  }
  const optional = setConnectedOptionSettings({ ...configuration(), rules: [rule] }, { required: false, quantity: 2, scaled: false });
  assert.equal(optional.role, "conditional_option");
  assert.equal(optional.rules[0].required, false);
  assert.equal(optional.rules[0].visible, true);
});

test("Exactly One blocks scaling and total quantities above one for both required and optional selections", () => {
  for (const selection of ["required_exactly_one", "optional_exactly_one"] as const) {
    for (const [quantity, scaled, invalid] of [[1, false, false], [2, false, true], [1, true, true], [2, true, true]] as const) {
      const draft = fixture(), plan = createSmartSetupReviewRouting(draft);
      const choices = connectedOptionChoices(draft, plan, "kit");
      const accessory = setConnectedOptionSettings({ ...configuration(), selection, rules: rebuildConnectedOptionRules(configuration(), choices, new Set([choices.find((c) => !c.disabledReason)!.key])) }, { required: true, quantity, scaled });
      assert.equal(accessory.selection, selection, "never silently changes selection");
      assert.equal(Boolean(connectedOptionQuantityIssue(selection, accessory.rules)), invalid);
      plan.routes[0].accessory = accessory;
      assert.equal(validateSmartSetupReviewRouting(draft, plan).valid, !invalid, "Apply remains blocked");
    }
  }
  for (const selection of ["required_at_least_one", "optional_multiple", "multiple"] as const) {
    assert.equal(connectedOptionQuantityIssue(selection, [{ target: { kind: "option_item", group_id: "panels", row_id: "panel-0" }, required: true, fixedQuantity: 2, scaleWithTargetQuantity: true }]), null);
  }
});

test("model picker preserves connections and option picker preserves models", () => {
  const draft = fixture(), plan = createSmartSetupReviewRouting(draft);
  const choices = connectedOptionChoices(draft, plan, "kit");
  const rules = rebuildConnectedOptionRules({ ...configuration(), rules: [model] }, choices, new Set([choices.find((c) => !c.disabledReason)!.key]));
  const connected = rules.find((r) => r.target?.kind === "option_item")!;
  assert.deepEqual(rebuildApplicableModelRules({ ...configuration(), rules }, [{ key: "base_model\u0000models\u0000m", target: { kind: "base_model", group_id: "models", row_id: "m" } }], new Set()), [connected]);
  assert.equal(rebuildConnectedOptionRules({ ...configuration(), rules }, choices, new Set())[0], model);
});

test("picker excludes self, transitive dependency loops, structural items and skipped groups", () => {
  const draft = fixture();
  draft.optionGroups.push({ ...draft.optionGroups[1], id: "supports", label: "Supports", items: [{ ...row("support"), role: "structural_support" }] });
  const plan = createSmartSetupReviewRouting(draft);
  plan.routes[1].accessory!.rules = [{ target: { kind: "option_item", group_id: "supports", row_id: "support" }, required: false }];
  plan.routes[2].accessory!.rules = [{ target: { kind: "option_item", group_id: "kit", row_id: "kit-item" }, required: false }];
  const choices = connectedOptionChoices(draft, plan, "kit");
  assert.match(choices.find((c) => c.target.group_id === "kit")!.disabledReason!, /itself/);
  assert.match(choices.find((c) => c.target.group_id === "panels")!.disabledReason!, /loop/);
  assert.match(choices.find((c) => c.target.group_id === "supports")!.disabledReason!, /older path/);
  assert.equal(rebuildConnectedOptionRules(configuration(), choices, new Set(choices.map((c) => c.key))).length, 0);
  plan.routes[1].accessory!.rules = [];
  plan.routes[1].destination = "skip";
  assert.match(connectedOptionChoices(draft, plan, "kit").find((c) => c.target.group_id === "panels")!.disabledReason!, /Accessories/);
});

test("mixed settings are detected; explicit owner choice normalises every connection", () => {
  const draft = fixture(), plan = createSmartSetupReviewRouting(draft), choices = connectedOptionChoices(draft, plan, "kit").filter((c) => !c.disabledReason);
  const rules = rebuildConnectedOptionRules(configuration(), choices, new Set(choices.map((c) => c.key)));
  rules[1] = { ...rules[1], required: false, fixedQuantity: 2, scaleWithTargetQuantity: false };
  const accessory = { ...configuration(), rules };
  assert.equal(connectedOptionSettings(accessory).mixed, true);
  const normal = setConnectedOptionSettings(accessory, { required: true, quantity: 2, scaled: false });
  assert.deepEqual(connectedOptionSettings(normal), { required: true, quantity: 2, scaled: false, mixed: false });
});

test("wording characterises neither, model-only, connected-only and combined rules", () => {
  const draft = fixture(), accessory = configuration();
  assert.deepEqual(optionApplicabilityText(draft, accessory, 16), { availability: "0 of 16 models selected", items: "0 applicable models", modelNote: null });
  assert.equal(optionApplicabilityText(draft, { ...accessory, role: "accessory" }, 16).availability, "available for all models");
  assert.equal(optionApplicabilityText(draft, { ...accessory, rules: [model] }, 16).availability, "1 of 16 models selected");
  const connected = { target: { kind: "option_item" as const, group_id: "panels", row_id: "panel-0" }, required: true };
  const only = optionApplicabilityText(draft, { ...accessory, rules: [connected] }, 16);
  assert.equal(only.availability, "Needs: Panels (1 options)");
  assert.equal(only.items, "Connected to 1 options");
  assert.equal(only.modelNote, "Not limited by model. This item follows the connected options below.");
  const both = optionApplicabilityText(draft, { ...accessory, rules: [model, connected] }, 16);
  assert.equal(both.availability, "1 models · 1 connected options");
  assert.equal(both.items, "1 applicable model · Connected to 1 options");
  assert.equal(both.modelNote, null);
});

test("valid connected targets have no issues; missing targets warn and block; removal uses reviewed rules", () => {
  const draft = fixture(), plan = createSmartSetupReviewRouting(draft), choices = connectedOptionChoices(draft, plan, "kit");
  const rules = rebuildConnectedOptionRules(configuration(), choices, new Set([choices.find((c) => !c.disabledReason)!.key]));
  plan.routes[0].accessory = { ...configuration(), rules };
  assert.deepEqual(connectedOptionIssues(draft, plan, plan.routes[0]), []);
  assert.equal(validateSmartSetupReviewRouting(draft, plan).valid, true);
  const target = rules[0].target!;
  assert.ok(connectedOptionKey(rules[0]));
  draft.optionGroups[0].conditionalConfiguration = { role: "companion", selection: "at_least_one", applicability: [{ target, visible: true, required: true, fixed_quantity: 1 }] };
  draft.optionGroups[1].items = [];
  assert.match(connectedOptionIssues(draft, plan, plan.routes[0]).join(" "), /no longer exists/);
  assert.equal(validateSmartSetupReviewRouting(draft, plan).valid, false);
  plan.routes[0].accessory!.rules = [];
  plan.routes[1].destination = "skip";
  assert.equal(validateSmartSetupReviewRouting(draft, plan).valid, true, "removed connection must not retain a stale draft dependency blocker");
});
