import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateAccessoryConfigurationForModel } from "./accessory-conditional-configuration";
import { parseAccessoryPricingJson } from "./accessory-pricing-parser";
import { normalizeProductTemplateDraft, type ProductTemplateDraft } from "./product-template-draft";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter";
import { applySmartRulesOnlyUpdate, defaultSmartRulesOnlyChoices, planSmartRulesOnlyUpdate } from "./smart-rules-only-update";
import { draftForSmartSetupReviewApply } from "./smart-product-review-routing";
import { ALL_GROUPS, allowedFor, FELT, FRONT_ID, incomingDraft, itemId, rule, snapshot, targetsOf, workspace } from "./testing/universal-screen-rules-fixture";

const FRONT_KEY = "option:us-og-front-stirrups";
// The front stirrups JSON has another id and another name, so the user picks the saved group once.
const PICKED = { "us-og-front-stirrups": FRONT_ID };
const report = (incoming: ProductTemplateDraft = incomingDraft(), manual: Record<string, string> = PICKED) => planSmartRulesOnlyUpdate(workspace().draft, workspace().plan, incoming, manual);
const run = (incoming: ProductTemplateDraft = incomingDraft(), choices = defaultSmartRulesOnlyChoices(report(incoming)), manual: Record<string, string> = PICKED) => {
  const current = workspace();
  return applySmartRulesOnlyUpdate(current.draft, current.plan, incoming, choices, manual);
};
const applied = (result: ReturnType<typeof run>) => { assert.deepEqual(result.errors, []); assert.ok(result.workspace); return result.workspace!; };
const savedGroups = (value: { draft: ProductTemplateDraft; plan: ReturnType<typeof workspace>["plan"] }) => mapDraftOptionGroupsToAccessories(draftForSmartSetupReviewApply(value.draft, value.plan), value.plan).groups;

test("the real front stirrups group matches neither by id nor by name: it is ignored, with a suggestion, until picked", () => {
  const first = report(incomingDraft(), {});
  assert.deepEqual(first.changes, []);
  assert.equal(first.unchangedCount, 5);
  assert.deepEqual(first.ignored, [{ id: "us-og-front-stirrups", name: "Front Stirrups (choose by desk type)", suggestion: { groupId: FRONT_ID, name: "Front Stirrups Kit Art.880", sharedItems: 1 } }]);
  assert.deepEqual(first.availableGroups, [{ groupId: FRONT_ID, name: "Front Stirrups Kit Art.880" }]);
  assert.equal(run(incomingDraft(), { [FRONT_KEY]: { apply: true, addItems: true } }, {}).workspace, null);
});

test("a JSON that uses the saved id matches automatically", () => {
  const incoming = incomingDraft();
  incoming.optionGroups[0]!.id = FRONT_ID;
  const result = report(incoming, {});
  assert.deepEqual([result.changes.map((change) => change.targetKey), result.ignored], [[`option:${FRONT_ID}`], []]);
});

test("golden: only Front Stirrups is shown, 7 targets -> 46, +6 items; every unchanged group is hidden and counted", () => {
  assert.equal(normalizeProductTemplateDraft(incomingDraft()).valid, true);
  const result = report();
  assert.deepEqual(result.changes.map((change) => change.key), [FRONT_KEY]);
  assert.equal(result.unchangedCount, 5, "includes Sound-Proofing Cover Kits, whose rules are the same in another order");
  assert.ok(!JSON.stringify(result.changes).includes("Sound-Proofing Cover Kits"));
  const change = result.changes[0]!;
  assert.deepEqual([change.name, change.targetsBefore, change.targetsAfter, change.neededItems.length], ["Front Stirrups Kit Art.880", 7, 46, 6]);
  assert.deepEqual(change.settingChanges, ['Name: "Front Stirrups Kit Art.880" -> "Front Stirrups (choose by desk type)"']);
  assert.equal(change.addedTargets.length, 39);
  assert.equal(change.removedTargets.length, 0);
  assert.equal(change.addedTargets[0], "felt-front: felt-front-r1");
  assert.ok(change.addedTargets.includes("us-m-uph-front-2bar: us-m-uph-front-2bar-r4"), "matrix rows are named too");
});

test("golden: each screen offers the right stirrups and the result passes the server's save check", () => {
  const result = run();
  const groups = savedGroups(applied(result));
  assert.equal(result.updatedCount, 1);
  assert.doesNotThrow(() => parseAccessoryPricingJson(JSON.stringify(groups), JSON.parse(snapshot.variant_pricing), JSON.parse(snapshot.category_pricing)));
  assert.deepEqual([groups[0]!.id, groups[0]!.group_name, groups[0]!.conditional_configuration!.applicability.length], [FRONT_ID, "Front Stirrups (choose by desk type)", 46]);
  for (const groupId of Object.keys(ALL_GROUPS)) for (const target of targetsOf(groupId)) {
    const front = evaluateAccessoryConfigurationForModel({ accessoryGroups: groups, baseModelGroupId: null, baseModelRowId: null, selectedModelTarget: target }).groups[0]!;
    assert.deepEqual([...front.allowedItemIds].sort(), [...allowedFor(groupId)].sort(), target.row_id);
    assert.equal(front.required, true);
  }
});

const without = (value: object, keys: string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

test("golden: everything except the rules fields and the added items is identical before and after", () => {
  const before = workspace();
  const after = applied(run());
  const withoutRules = (value: { draft: ProductTemplateDraft; plan: ReturnType<typeof workspace>["plan"] }) => ({
    draft: { ...value.draft, optionGroups: value.draft.optionGroups.map((group) => {
      if (group.id !== FRONT_ID) return group;
      return { ...without(group, ["label", "selection", "conditionalConfiguration"]), items: group.items.slice(0, 1) };
    }) },
    plan: { routes: value.plan.routes.map((route) => {
      if (route.sourceId !== FRONT_ID) return route;
      return without(route, ["groupName", "sourceName", "accessory", "rowCount"]);
    }) },
  });
  assert.deepStrictEqual(withoutRules(after), withoutRules(before));
  // The saved item (price 12, old name) is untouched although the JSON carries other data for it.
  assert.deepStrictEqual(after.draft.optionGroups[0]!.items[0], before.draft.optionGroups[0]!.items[0]);
  assert.deepEqual(after.draft.optionGroups[0]!.items.map((item) => item.id), FELT.map(itemId));
  // Group and item ids key the saved pictures; sort order, active status and saved item rows stay.
  const [savedBefore, savedAfter] = [savedGroups(before), savedGroups(after)];
  assert.deepStrictEqual(savedAfter.slice(1), savedBefore.slice(1));
  for (const key of ["id", "sort_order", "is_active"] as const) assert.equal(savedAfter[0]![key], savedBefore[0]![key]);
  assert.deepStrictEqual(savedAfter[0]!.items[0], savedBefore[0]!.items[0]);
});

test("new items arrive exactly as Add More JSON adds them", () => {
  const added = applied(run()).draft.optionGroups[0]!.items[1]!;
  assert.deepStrictEqual(added, incomingDraft().optionGroups[0]!.items[1]);
});

test("the workspace passed in is never changed", () => {
  const current = workspace();
  const copy = structuredClone(current);
  const incoming = incomingDraft();
  applySmartRulesOnlyUpdate(current.draft, current.plan, incoming, defaultSmartRulesOnlyChoices(report(incoming)), PICKED);
  assert.deepStrictEqual(current, copy);
  assert.deepStrictEqual(incoming, incomingDraft());
});

test("missing items block Apply until the add-items box is ticked", () => {
  const blocked = run(incomingDraft(), { [FRONT_KEY]: { apply: true, addItems: false } });
  assert.equal(blocked.workspace, null);
  assert.match(blocked.errors.join(" "), /needs 6 new items.*Front Stirrup 883.*Also add these 6 items.*untick this group/);
  assert.ok(run(incomingDraft(), { [FRONT_KEY]: { apply: true, addItems: true } }).workspace);
});

test("an unticked group is skipped and nothing is applied", () => {
  const result = run(incomingDraft(), { [FRONT_KEY]: { apply: false, addItems: true } });
  assert.deepEqual([result.workspace, result.updatedCount, result.errors], [null, 0, []]);
});

test("items the rules never mention are not added", () => {
  const incoming = incomingDraft();
  incoming.optionGroups[0]!.items.push({ ...incoming.optionGroups[0]!.items[1]!, id: "us-extra", supplierCodes: ["999"] });
  assert.equal(applied(run(incoming)).draft.optionGroups[0]!.items.length, 7);
});

test("an unmatched group is listed and ignored; a different id still matches by exact name", () => {
  const incoming = incomingDraft();
  incoming.optionGroups.push({ ...structuredClone(incoming.optionGroups[1]!), id: "us-og-unknown", label: "Cable Tray" });
  incoming.optionGroups[4] = { ...incoming.optionGroups[4]!, id: "renamed-id", label: "  sound-proofing COVER kits " };
  const result = report(incoming);
  assert.deepEqual(result.ignored.map((entry) => entry.name), ["Front Stirrups (choose by desk type)", "Cable Tray"]);
  assert.deepEqual(result.changes.map((change) => change.key), [FRONT_KEY, "option:renamed-id"], "matched by name: only its label text differs");
  const after = applied(run(incoming, { [FRONT_KEY]: { apply: true, addItems: true }, "option:renamed-id": { apply: false, addItems: true } }));
  assert.equal(after.draft.optionGroups.length, workspace().draft.optionGroups.length);
});

const blockedBy = (incoming: ProductTemplateDraft, expected: RegExp) => {
  const result = run(incoming);
  assert.equal(result.workspace, null);
  assert.match(result.errors.join("\n"), expected);
};
const front = (mutate: (group: ProductTemplateDraft["optionGroups"][number]) => void) => { const incoming = incomingDraft(); mutate(incoming.optionGroups[0]!); return incoming; };

test("Apply is blocked with a plain reason: unknown row, bad item, twins, reused id, missing rules", () => {
  blockedBy(front((group) => { group.conditionalConfiguration!.applicability[0] = rule({ kind: "base_model", group_id: "felt-front", row_id: "no-such-row" }, [itemId("880")]); }), /not in this template: felt-front \/ no-such-row/);
  blockedBy(front((group) => { group.conditionalConfiguration!.applicability[0]!.allowed_item_ids = ["us-stirrup-999"]; }), /allowed item/i);
  blockedBy(front((group) => { group.items[1] = { ...group.items[1]!, supplierCodes: ["880"] }; }), /same item/i);
  blockedBy(front((group) => {
    group.items[1] = { ...group.items[1]!, id: "us-opt-920" };
    group.conditionalConfiguration!.applicability = group.conditionalConfiguration!.applicability.map((entry) => ({ ...entry, allowed_item_ids: entry.allowed_item_ids!.map((id) => id === itemId("883") ? "us-opt-920" : id) }));
  }), /already used/i);
  blockedBy(front((group) => { delete group.conditionalConfiguration; }), /no rules/i);
});

test("saved items left out of every allowed list produce the same warning count as Add More JSON", () => {
  const incoming = front((group) => {
    group.items = group.items.filter((item) => item.id === itemId("883"));
    group.conditionalConfiguration!.applicability = targetsOf("mel-front").map((target) => rule(target, [itemId("883")]));
  });
  assert.equal(run(incoming).unnamed[FRONT_KEY], 1);
});

test("wiring: a separate edit-mode button reusing the same parser; Apply only changes the review workspace", () => {
  const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const modal = read("components/products/smart-product-json-import.tsx");
  ["Update Rules from JSON</button>", "<SmartRulesUpdateDialog", "parse={parseSmartProductJsonWithFallback}", "setRulesUpdatedCount(updatedCount)", "Also update this group&apos;s rules and label"].forEach((expected) => assert.ok(modal.includes(expected), expected));
  for (const file of ["components/products/smart-rules-update-dialog.tsx", "lib/products/smart-rules-only-update.ts"]) {
    assert.doesNotMatch(read(file), /supabase|\/actions"|fetch\(|requestSubmit|parseSmartProductJsonImport\(/i, file);
  }
});
