import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft } from "./product-template-draft";
import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups";
import { addReviewedOptionGroup, addReviewedOptionLine, moveReviewedOptionLine, removeReviewedOptionLine, syncReviewedOptionItemLists, toggleReviewedOptionDefault } from "./smart-product-review";
import { createSmartSetupReviewRouting, validateSmartSetupReviewRouting } from "./smart-product-review-routing";
import { mapSmartDraftForApply } from "./smart-setup-apply-preview";
import { addAccessoryItemToRuleLists, allowUnlistedItems, removeAccessoryItemFromRuleLists } from "./accessory-conditional-configuration-ui-state";

// Joyce-like: a required "Plastic Parts Finish" group, 45 base models, EVERY rule allows only the imported item.
const line = (id: string) => ({ id, label: id, displayName: id, supplierCodes: [id.toUpperCase()], referenceCodes: [], dimensions: null, currency: "EUR" as const, price: 0, specification: null });
const models = Array.from({ length: 45 }, (_, i) => `m${i}`);
const model = (id: string) => ({ id, label: id, displayName: id, supplierCodes: [], referenceCodes: [], dimensions: null, currency: "EUR", price: 100, specification: null });
const rule = (id: string, list?: string[]) => ({ target: { kind: "base_model" as const, group_id: LEGACY_BASE_MODEL_GROUP_ID, row_id: id }, required: true, visible: true, fixed_quantity: 1, ...(list ? { allowed_item_ids: list } : {}) });
const make = (withLists: boolean): ProductTemplateDraft => ({
  pricing: { workstationRows: [], baseModelRows: models.map(model), priceMatrices: [], modularGroups: [] },
  optionGroups: [{ id: "plastic", label: "Plastic Parts Finish", selection: { mode: "required_choose_at_least_one", minSelections: 1, maxSelections: 1, defaultItemIds: [] }, items: [line("item1")],
    conditionalConfiguration: { role: "accessory", selection: "exactly_one", applicability: models.map((id) => rule(id, withLists ? ["item1"] : undefined)) } }],
}) as unknown as ProductTemplateDraft;
const manual = { id: "uuid-black", name: "Black 3217", supplierCode: "3217", price: "0", specification: "" };
const lists = (draft: ProductTemplateDraft) => draft.optionGroups[0].conditionalConfiguration!.applicability.map((r) => r.allowed_item_ids);

test("review screen: a hand-added item joins all 45 explicit lists; routing validation passes and the apply output keeps it", () => {
  const added = addReviewedOptionLine(make(true), 0, manual);
  assert.equal(lists(added).length, 45);
  assert.ok(lists(added).every((list) => JSON.stringify(list) === JSON.stringify(["item1", "uuid-black"])));
  const plan = createSmartSetupReviewRouting(added);
  assert.deepEqual(validateSmartSetupReviewRouting(added, plan).errors, []);
  const { groups, errors } = mapSmartDraftForApply(added, plan).accessoryResult;
  assert.deepEqual(errors, []);
  const rules = groups[0].conditional_configuration!.applicability;
  assert.equal(rules.length, 45);
  assert.ok(rules.every((r) => JSON.stringify(r.allowed_item_ids) === JSON.stringify(["item1", "uuid-black"])));
});

test("the plan rules (what Apply reads for a reviewed group) follow the item list through the sync helper", () => {
  const draft = make(true), plan = createSmartSetupReviewRouting(draft);
  const route = () => (p: typeof plan) => p.routes.find((r) => r.sourceId === "plastic")!.accessory!.rules;
  const added = syncReviewedOptionItemLists(plan, "plastic", { added: ["uuid-black"] });
  assert.ok(route()(added).every((r) => JSON.stringify(r.allowedItemIds) === JSON.stringify(["item1", "uuid-black"])));
  const back = syncReviewedOptionItemLists(added, "plastic", { removed: ["uuid-black"] });
  assert.ok(route()(back).every((r) => JSON.stringify(r.allowedItemIds) === JSON.stringify(["item1"])));
  const other = syncReviewedOptionItemLists(plan, "nothing", { added: ["x"] });
  assert.equal(other, other, "unknown group: routes unchanged");
  assert.deepEqual(other.routes, plan.routes);
});

test("a group whose rules have no lists stays without lists", () => {
  const added = addReviewedOptionLine(make(false), 0, manual);
  assert.ok(lists(added).every((list) => list === undefined));
  const plan = syncReviewedOptionItemLists(createSmartSetupReviewRouting(added), "plastic", { added: ["uuid-black"] });
  assert.ok(plan.routes.find((r) => r.sourceId === "plastic")!.accessory!.rules.every((r) => r.allowedItemIds === undefined));
  assert.ok(mapSmartDraftForApply(added, plan).accessoryResult.groups[0].conditional_configuration!.applicability.every((r) => r.allowed_item_ids === undefined));
});

test("removing the manual item restores the lists; move and set-default do not change them", () => {
  const added = addReviewedOptionLine(make(true), 0, manual);
  const moved = moveReviewedOptionLine(added, 0, 1, -1), defaulted = toggleReviewedOptionDefault(moved, 0, "uuid-black");
  assert.deepEqual(lists(moved), lists(added)); assert.deepEqual(lists(defaulted), lists(added));
  assert.deepEqual(defaulted.optionGroups[0].selection.defaultItemIds, ["uuid-black"]);
  const removed = removeReviewedOptionLine(defaulted, 0, "uuid-black");
  assert.ok(lists(removed).every((list) => JSON.stringify(list) === JSON.stringify(["item1"])));
  assert.deepEqual(removed.optionGroups[0].selection.defaultItemIds, []);
});

test("Joyce-like Required group: the hand-added default item is allowed on every model after the fix", () => {
  let draft = addReviewedOptionLine(make(true), 0, manual);
  draft = toggleReviewedOptionDefault(draft, 0, "uuid-black");
  const group = mapSmartDraftForApply(draft, createSmartSetupReviewRouting(draft)).accessoryResult.groups[0];
  assert.deepEqual(group.default_item_ids, ["uuid-black"]);
  assert.equal(group.group_is_required, true);
  assert.ok(group.conditional_configuration!.applicability.every((r) => r.allowed_item_ids!.includes("uuid-black")), "allowed on all 45 models");
});

test("safety net at apply: an item in no list is added to every list; an item already in some list is left alone", () => {
  const draft = make(true);
  const hidden = { ...draft, optionGroups: [{ ...draft.optionGroups[0], items: [line("item1"), line("uuid-black")] }] } as ProductTemplateDraft;
  const rules = mapSmartDraftForApply(hidden, createSmartSetupReviewRouting(hidden)).accessoryResult.groups[0].conditional_configuration!.applicability;
  assert.ok(rules.every((r) => JSON.stringify(r.allowed_item_ids) === JSON.stringify(["item1", "uuid-black"])));
  const partial = [{ allowed_item_ids: ["a"] }, { allowed_item_ids: ["a", "b"] }, {}];
  assert.deepEqual(allowUnlistedItems(partial, ["a", "b"]), partial, "b is in one list: nothing changes");
  assert.deepEqual(allowUnlistedItems(partial, ["a", "b", "c"]), [{ allowed_item_ids: ["a", "c"] }, { allowed_item_ids: ["a", "b", "c"] }, {}], "only c is hidden; the rule without a list stays without");
  assert.deepEqual(allowUnlistedItems([{}, {}], ["a"]), [{}, {}], "no lists at all: nothing is added");
});

test("a new manual group keeps its default: no rules, all models, no lists", () => {
  const out = addReviewedOptionGroup(make(true), createSmartSetupReviewRouting(make(true)), { groupId: "g2", groupName: "Extras", ...manual, id: "first" });
  assert.equal(out.reason, undefined);
  const created = out.draft.optionGroups.find((g) => g.id === "g2")!;
  assert.equal(created.conditionalConfiguration, undefined);
  assert.deepEqual(out.plan!.routes.find((r) => r.sourceId === "g2")!.accessory!.rules, []);
});

test("post-save editor helpers: add joins every explicit list, remove leaves every list, rules without lists are untouched", () => {
  const group = { id: "g", group_name: "Plastic", items: [], conditional_configuration: { role: "accessory" as const, selection: "exactly_one" as const, applicability: [rule("m0", ["item1"]), rule("m1")] } };
  const added = addAccessoryItemToRuleLists(group as never, "new-id").conditional_configuration!.applicability;
  assert.deepEqual(added.map((r) => r.allowed_item_ids), [["item1", "new-id"], undefined]);
  const removed = removeAccessoryItemFromRuleLists({ ...group, conditional_configuration: { ...group.conditional_configuration, applicability: added } } as never, "new-id").conditional_configuration!.applicability;
  assert.deepEqual(removed.map((r) => r.allowed_item_ids), [["item1"], undefined]);
  const bare = { id: "g", group_name: "x", items: [] };
  assert.equal(addAccessoryItemToRuleLists(bare as never, "z"), bare, "a group without a configuration is returned unchanged");
});
