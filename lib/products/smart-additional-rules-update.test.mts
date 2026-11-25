import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseAccessoryPricingJson } from "./accessory-pricing-parser";
import { applySmartAdditionalJson, smartAdditionalJsonGroups, smartAdditionalRulesReport, type SmartAdditionalGroupDecision } from "./smart-product-additional-json";
import { evaluateAccessoryConfigurationForModel, type AccessoryApplicabilityTarget } from "./accessory-conditional-configuration";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter";
import { normalizeProductTemplateDraft, type ProductTemplateDraft } from "./product-template-draft";
import { productTemplateFormSmartWorkspace } from "./product-template-form-smart-workspace";
import { validateSmartSetupReviewRouting } from "./smart-product-review-routing";

// Rebuilt from the "universal Screen" case: saved group ids, item codes and target groups are real; row ids and prices are made up.
const BASE = { "felt-front": 6, "felt-lateral": 4, "felt-modesty": 3, "mel-front": 6, "sp30-front": 5 } as const;
const MATRIX = { "us-m-fabric-front": 5, "us-m-sp38-front": 5, "us-m-uph-front": 4, "us-m-uph-front-1bar": 4, "us-m-uph-front-2bar": 4 } as const;
const ALL_GROUPS: Record<string, number> = { ...BASE, ...MATRIX };
const rowsOf = (groupId: string) => Array.from({ length: ALL_GROUPS[groupId]! }, (_, i) => `${groupId}-r${i + 1}`);
const targetsOf = (groupId: string): AccessoryApplicabilityTarget[] => rowsOf(groupId).map((row_id) => ({ kind: groupId in BASE ? "base_model" : "price_matrix", group_id: groupId, row_id }));

const FRONT = ["880", "883", "885", "464", "465"];
const FELT = [...FRONT, "887", "466"];
const itemId = (code: string) => `us-stirrup-${code}`;
const allowedFor = (groupId: string) => (groupId === "felt-front" ? FELT : groupId === "felt-lateral" || groupId === "felt-modesty" ? ["880"] : FRONT).map(itemId);
const rule = (target: AccessoryApplicabilityTarget, allowed: string[], required = true) => ({ target, required, visible: true, allowed_item_ids: allowed });

const savedItem = (id: string, name: string, code: string, price: number, sort = 0) => ({ id, item_name: name, supplier_price_list_code: code, price, currency: "EUR", specification: `${name} spec`, is_active: true, sort_order: sort });
const savedGroup = (id: string, name: string, items: ReturnType<typeof savedItem>[], rules: ReturnType<typeof rule>[], required: boolean, sort: number) => ({ id, group_name: name, group_is_required: required, is_active: true, sort_order: sort, items, ...(rules.length ? { conditional_configuration: { role: "accessory", selection: required ? "at_least_one" : "unrestricted", applicability: rules } } : {}) });

const otherGroups = [
  savedGroup("us-og-lateral", "Lateral Stirrups", [savedItem("us-lat-881", "Lateral Kit", "881", 20)], targetsOf("felt-lateral").map((t) => rule(t, ["us-lat-881"])), true, 1),
  savedGroup("us-og-modesty", "Modesty Stirrups", [savedItem("us-mod-890", "Modesty Kit", "890", 15)], targetsOf("felt-modesty").map((t) => rule(t, ["us-mod-890"])), true, 2),
  savedGroup("us-og-barcover", "Accessory Bar Covers", [savedItem("us-cov-900", "Bar Cover", "900", 5)], targetsOf("us-m-uph-front-1bar").map((t) => rule(t, ["us-cov-900"], false)), false, 3),
  savedGroup("us-og-freestanding", "Freestanding Screen Stirrup", [savedItem("us-free-910", "Freestanding Stirrup", "910", 30)], targetsOf("mel-front").map((t) => rule(t, ["us-free-910"], false)), false, 4),
  savedGroup("us-og-optional", "Optional Items", [savedItem("us-opt-920", "Clamp", "920", 3)], [], false, 5),
];

const frontRulesBefore = [...targetsOf("felt-lateral"), ...targetsOf("felt-modesty")].map((t) => rule(t, [itemId("880")]));
const snapshot = {
  currency: "EUR",
  desking_size_pricing: "[]",
  modular_item_pricing: "[]",
  variant_pricing: JSON.stringify(Object.keys(BASE).map((id, i) => ({ id, pricing_type: "base_model_group", group_name: id, is_active: true, sort_order: i, items: rowsOf(id).map((row, k) => ({ id: row, variant_name: row, price: 100 + k, currency: "EUR", is_active: true, sort_order: k })) }))),
  category_pricing: JSON.stringify(Object.keys(MATRIX).map((id, i) => ({ id, pricing_type: "category_group", group_name: id, is_active: true, sort_order: i, price_categories: ["B", "C"], items: rowsOf(id).map((row, k) => ({ id: row, variant_name: row, prices: { B: 200 + k, C: 210 + k }, currency: "EUR", is_active: true, sort_order: k })) }))),
  accessory_pricing: JSON.stringify([savedGroup("us-og-front-stirrups-880", "Front Stirrups Kit Art.880", [savedItem(itemId("880"), "103 880 Front Stirrup", "880", 12)], frontRulesBefore, true, 0), ...otherGroups]),
};

const workspace = productTemplateFormSmartWorkspace(snapshot);

function incomingDraft(options: { rules?: ReturnType<typeof rule>[]; noRules?: boolean } = {}): ProductTemplateDraft {
  const rules = options.rules ?? Object.keys(ALL_GROUPS).flatMap((groupId) => targetsOf(groupId).map((t) => rule(t, allowedFor(groupId))));
  const source = workspace.draft.optionGroups[0]!.items[0]!;
  const items = FELT.map((code) => code === "880"
    // Same item as saved: only the display name and reference code differ.
    ? { ...source, label: "Front Stirrup 880", displayName: "Front Stirrup 880", referenceCodes: ["103"] }
    : { ...source, id: itemId(code), label: `Front Stirrup ${code}`, displayName: `Front Stirrup ${code}`, supplierCodes: [code], referenceCodes: [], price: 12 + Number(code) % 7 });
  const front = {
    id: "us-og-front-stirrups", label: "Front Stirrups (choose by desk type)", items,
    selection: { mode: "required_choose_at_least_one" as const, minSelections: 1, maxSelections: null, defaultItemIds: [] },
    ...(options.noRules ? {} : { conditionalConfiguration: { role: "accessory" as const, selection: "at_least_one" as const, applicability: rules } }),
  };
  return { ...structuredClone(workspace.draft), pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] }, optionGroups: [front, ...structuredClone(workspace.draft.optionGroups.slice(1))] };
}

const FRONT_KEY = "option:us-og-front-stirrups";
const SAVED_KEY = "option:us-og-front-stirrups-880";
const decisions = (updateRules?: boolean, extra: Record<string, "existing" | "incoming"> = {}): Record<string, SmartAdditionalGroupDecision> => ({
  [FRONT_KEY]: { action: "merge", destination: "accessory", targetKey: SAVED_KEY, duplicateChoices: extra, ...(updateRules === undefined ? {} : { updateRules }) },
});

const saved = (result: { draft: ProductTemplateDraft; plan: typeof workspace.plan }) => mapDraftOptionGroupsToAccessories(result.draft, result.plan).groups;
const frontOn = (groups: ReturnType<typeof saved>, target: AccessoryApplicabilityTarget) => evaluateAccessoryConfigurationForModel({ accessoryGroups: groups, baseModelGroupId: null, baseModelRowId: null, selectedModelTarget: target }).groups.find((group) => group.groupId === "us-og-front-stirrups-880")!;

test("the fixture matches the reported case", () => {
  assert.equal(frontRulesBefore.length, 7);
  assert.equal(incomingDraft().optionGroups[0]!.conditionalConfiguration!.applicability.length, 46);
  assert.equal(normalizeProductTemplateDraft(incomingDraft()).valid, true);
  const match = smartAdditionalJsonGroups(workspace.draft, workspace.plan, incomingDraft()).find((group) => group.route.key === FRONT_KEY)!;
  assert.equal(match.match.recommendedAction, "merge");
  assert.deepEqual([match.match.evidence.matchingItems, match.match.evidence.newItems], [1, 6]);
});

test("golden: updating rules keeps the group id and applies the new label, required flag and targets", () => {
  const result = applySmartAdditionalJson(workspace.draft, workspace.plan, incomingDraft(), decisions(true));
  assert.deepEqual(validateSmartSetupReviewRouting(result.draft, result.plan).errors, []);
  const groups = saved(result);
  const front = groups[0]!;
  assert.deepEqual([front.id, front.group_name, front.group_is_required], ["us-og-front-stirrups-880", "Front Stirrups (choose by desk type)", true]);
  assert.equal(front.conditional_configuration!.applicability.length, 46);
  assert.deepEqual(front.items.map((item) => item.id), FELT.map(itemId));
  // The server's own save check accepts it.
  assert.doesNotThrow(() => parseAccessoryPricingJson(JSON.stringify(groups), JSON.parse(snapshot.variant_pricing), JSON.parse(snapshot.category_pricing)));

  for (const groupId of Object.keys(ALL_GROUPS)) {
    for (const target of targetsOf(groupId)) {
      const evaluation = frontOn(groups, target);
      assert.deepEqual([evaluation.visible, evaluation.required, evaluation.minSelections], [true, true, 1], `${target.row_id}`);
      assert.deepEqual([...evaluation.allowedItemIds].sort(), [...allowedFor(groupId)].sort(), `${target.row_id}`);
    }
  }
});

test("golden: every other option group is unchanged", () => {
  const before = saved({ draft: workspace.draft, plan: workspace.plan });
  const after = saved(applySmartAdditionalJson(workspace.draft, workspace.plan, incomingDraft(), decisions(true)));
  assert.deepEqual(after.slice(1), before.slice(1));
});

test("the kept item keeps its saved data; Use Incoming changes it only when chosen; pricing rows are untouched", () => {
  const kept = applySmartAdditionalJson(workspace.draft, workspace.plan, incomingDraft(), decisions(true));
  assert.deepEqual(saved(kept)[0]!.items[0], saved({ draft: workspace.draft, plan: workspace.plan })[0]!.items[0]);
  const replaced = applySmartAdditionalJson(workspace.draft, workspace.plan, incomingDraft(), decisions(true, { [itemId("880")]: "incoming" }));
  assert.deepEqual([saved(replaced)[0]!.items[0]!.id, saved(replaced)[0]!.items[0]!.item_name], [itemId("880"), "Front Stirrup 880"]);
  assert.deepEqual(kept.draft.pricing, workspace.draft.pricing);
});

test("an item matched by code but sent with another id keeps the saved id, and the new rules follow it", () => {
  const incoming = incomingDraft();
  const front = incoming.optionGroups[0]!;
  front.items[0] = { ...front.items[0]!, id: "other-880" };
  front.conditionalConfiguration!.applicability = front.conditionalConfiguration!.applicability.map((entry) => ({ ...entry, allowed_item_ids: entry.allowed_item_ids!.map((id) => id === itemId("880") ? "other-880" : id) }));
  const result = applySmartAdditionalJson(workspace.draft, workspace.plan, incoming, decisions(true));
  assert.equal(saved(result)[0]!.items[0]!.id, itemId("880"));
  assert.ok(!JSON.stringify(saved(result)).includes("other-880"));
});

test("default OFF is exactly the previous merge: items only, with the old label and rules", () => {
  const off = applySmartAdditionalJson(workspace.draft, workspace.plan, incomingDraft(), decisions());
  assert.deepEqual(applySmartAdditionalJson(workspace.draft, workspace.plan, incomingDraft(), decisions(false)), off);
  assert.deepEqual(off.plan, { routes: workspace.plan.routes.map((route) => route.key === SAVED_KEY ? { ...route, rowCount: 7 } : route) });
  const { items: afterItems, ...afterGroup } = off.draft.optionGroups[0]!;
  const { items: beforeItems, ...beforeGroup } = workspace.draft.optionGroups[0]!;
  assert.deepEqual(afterGroup, beforeGroup);
  assert.deepEqual([beforeItems.length, afterItems.length], [1, 7]);
});

test("the preview reports targets before and after and the items added, without changing the workspace", () => {
  const original = structuredClone(workspace);
  const report = smartAdditionalRulesReport(workspace.draft, workspace.plan, incomingDraft(), decisions(true));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.previews[FRONT_KEY], { before: 7, after: 46, added: 6, unnamedExisting: 0 });
  assert.deepEqual(workspace, original);
  assert.deepEqual(smartAdditionalRulesReport(workspace.draft, workspace.plan, incomingDraft(), decisions()), { errors: [], previews: {} });
});

const blocked = (incoming: ProductTemplateDraft, expected: RegExp, choice = decisions(true)) => {
  const original = structuredClone(workspace);
  const report = smartAdditionalRulesReport(workspace.draft, workspace.plan, incoming, choice);
  assert.match(report.errors.join("\n"), expected);
  assert.throws(() => applySmartAdditionalJson(workspace.draft, workspace.plan, incoming, choice), expected);
  assert.deepEqual(workspace, original, "nothing changed");
};

test("invalid references are blocked: unknown allowed item", () => {
  const incoming = incomingDraft();
  incoming.optionGroups[0]!.conditionalConfiguration!.applicability[0]!.allowed_item_ids = ["us-stirrup-999"];
  blocked(incoming, /allowed item/i);
});

test("invalid references are blocked: target row that is not in the template", () => {
  blocked(incomingDraft({ rules: [rule({ kind: "base_model", group_id: "felt-front", row_id: "no-such-row" }, [itemId("880")])] }), /not routed to|does not exist/i);
});

test("invalid references are blocked: a new item id already used by another accessory group", () => {
  const incoming = incomingDraft();
  const front = incoming.optionGroups[0]!;
  front.items[1] = { ...front.items[1]!, id: "us-opt-920" };
  front.conditionalConfiguration!.applicability = front.conditionalConfiguration!.applicability.map((entry) => ({ ...entry, allowed_item_ids: entry.allowed_item_ids!.map((id) => id === itemId("883") ? "us-opt-920" : id) }));
  blocked(incoming, /already used/i);
});

test("invalid updates are blocked: two incoming items matching one saved item, and a group without rules", () => {
  const twins = incomingDraft();
  twins.optionGroups[0]!.items[1] = { ...twins.optionGroups[0]!.items[1]!, supplierCodes: ["880"] };
  blocked(twins, /same item/i);
  blocked(incomingDraft({ noRules: true }), /no rules/i);
});

test("saved items the new rules do not name are counted for the preview", () => {
  const rules = targetsOf("mel-front").map((t) => rule(t, [itemId("883")]));
  const incoming = incomingDraft({ rules });
  incoming.optionGroups[0]!.items = incoming.optionGroups[0]!.items.filter((item) => item.id === itemId("883"));
  assert.equal(smartAdditionalRulesReport(workspace.draft, workspace.plan, incoming, decisions(true)).previews[FRONT_KEY]!.unnamedExisting, 1);
});

test("dialog wiring: an opt-in checkbox for a chosen existing option group, a preview line, and a blocked commit", () => {
  const dialog = readFileSync("components/products/smart-product-json-import.tsx", "utf8").replace(/\r\n/g, "\n");
  [
    "Also update this group&apos;s rules and label",
    "checked={decision.updateRules === true}",
    "Rules will change: {preview.before} targets before, {preview.after} after; items +{preview.added}",
    'target?.sourceKind === "option"',
    "rulesReport.errors.length > 0",
    "updateRules: false",
  ].forEach((expected) => assert.ok(dialog.includes(expected), `Expected dialog wiring: ${expected}`));
});
