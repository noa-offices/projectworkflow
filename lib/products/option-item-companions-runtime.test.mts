import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AccessoryApplicabilityTarget } from "./accessory-conditional-configuration.js";
import {
  deriveOptionItemTargets,
  evaluateWithOptionItemPass,
  hasOrdinaryOptionItemRules,
  ordinaryOptionItemDependentItemIds,
  ordinaryOptionItemGroupIds,
  withoutOrdinaryOptionItemDependentQuantities,
  type OptionItemExtraTargets,
  type OptionItemPassGroup,
} from "./option-item-targets.js";
import { effectiveRequiredQuantities, requiredComponentTriggerKey } from "../quotations/required-component-overrides.js";
import { evaluateProductAccessorySelection } from "../quotations/product-accessory-configuration.js";

// ---------------------------------------------------------------------------
// Fixture mirroring the Oxi_T shape: Desk Extension, Modesty Panels (5 items, per-desk allowed ids), and a
// companion Stirrup Kit with 5 option_item rules. Generic ids and prices only.
// ---------------------------------------------------------------------------

const widths = ["80", "100", "120", "140", "160"];
const PANEL_GROUP = "oxi-t-modesty-panels";
const KIT_GROUP = "oxi-t-stirrup-kit";
const KIT_ITEM = "stirrup-kit";
const desk = (id: string): AccessoryApplicabilityTarget => ({ kind: "base_model", group_id: "oxi-t-desks", row_id: id });
const panelPrice = 37;
const kitPrice = 12;

function fixture(options: { kitRequired?: boolean; panelRole?: string } = {}) {
  const kitRequired = options.kitRequired !== false;
  const panelRule = (deskId: string, allowed: string[]) => ({ target: desk(deskId), visible: true, required: false, allowed_item_ids: allowed });
  return [
    {
      id: "oxi-t-desk-extension", group_name: "Desk Extension", group_is_required: false, is_active: true, sort_order: 0,
      items: [{ id: "extension-80", item_name: "Desk Extension W80", price: 168, is_active: true }],
      conditional_configuration: { role: "accessory", selection: "unrestricted", applicability: ["desk-120", "desk-140", "desk-wide", "desk-180"].map((id) => ({ target: desk(id), visible: true, required: false })) },
    },
    {
      id: PANEL_GROUP, group_name: "Modesty Panels", group_is_required: false, is_active: true, sort_order: 1,
      items: widths.map((width) => ({ id: `panel-${width}`, item_name: `Modesty Panel W${width}`, price: panelPrice, is_active: true, ...(options.panelRole ? { role: options.panelRole } : {}) })),
      conditional_configuration: {
        role: "accessory", selection: "unrestricted",
        applicability: [
          panelRule("desk-120", ["panel-120"]),
          panelRule("desk-140", ["panel-140"]),
          panelRule("desk-wide", ["panel-120", "panel-140"]),
          panelRule("desk-180", ["panel-160"]),
        ],
      },
    },
    {
      id: KIT_GROUP, group_name: "Stirrup Kit for Modesty Panels", group_is_required: true, is_active: true, sort_order: 2,
      items: [{ id: KIT_ITEM, item_name: "Set of 2 Stirrups for Modesty Panels", price: kitPrice, is_active: true }],
      conditional_configuration: {
        role: "companion", selection: "at_least_one",
        applicability: widths.map((width) => ({ target: { kind: "option_item", group_id: PANEL_GROUP, row_id: `panel-${width}` }, visible: true, required: kitRequired, fixed_quantity: 1, scale_with_target_quantity: true })),
      },
    },
  ];
}

/** A template that has no option_item rules at all (characterisation of today's behaviour). */
function fixtureWithoutOptionItemRules() {
  const groups = fixture();
  return groups.slice(0, 2);
}

const asPassGroups = (groups: unknown) => groups as unknown as OptionItemPassGroup[];

/** Server shape: one shared helper, submitted quantities in, evaluation out. */
function serverEvaluate(groups: unknown, main: AccessoryApplicabilityTarget, submitted: Record<string, number>) {
  return evaluateWithOptionItemPass({
    groups: asPassGroups(groups),
    evaluate: (extra: OptionItemExtraTargets | null) => evaluateProductAccessorySelection({
      accessoryGroups: groups,
      baseModelGroupId: null,
      baseModelRowId: null,
      selectedModelTarget: main,
      selectedModelTargets: [main, ...(extra?.targets ?? [])],
      selectedModelTargetQuantities: { ...(extra?.quantities ?? {}) },
      selectedQuantities: submitted,
      allowRequiredCompanionOverrides: true,
    }),
  });
}

/** Client shape: mirrors the selector's evaluation flow (first pass, derive targets, second pass with required quantities). */
function clientEvaluate(groups: unknown, main: AccessoryApplicabilityTarget, raw: Record<string, number>, overrides: Record<string, { quantity: number; trigger: string }> = {}) {
  const passGroups = asPassGroups(groups);
  const evaluate = (selectedQuantities: Record<string, number>, extra: OptionItemExtraTargets | null) => evaluateProductAccessorySelection({
    accessoryGroups: groups,
    baseModelGroupId: null,
    baseModelRowId: null,
    selectedModelTarget: main,
    selectedModelTargets: [main, ...(extra?.targets ?? [])],
    selectedModelTargetQuantities: { ...(extra?.quantities ?? {}) },
    selectedQuantities,
    allowRequiredCompanionOverrides: true,
  });
  const enabled = hasOrdinaryOptionItemRules(passGroups);
  const dependentGroups = ordinaryOptionItemGroupIds(passGroups);
  const firstPassQuantities = enabled ? withoutOrdinaryOptionItemDependentQuantities(passGroups, raw) : raw;
  const first = evaluate(firstPassQuantities, null);
  const extra = enabled ? deriveOptionItemTargets({ groups: passGroups, activeQuantities: first.activeQuantities }) : null;
  const active = Boolean(extra?.targets.length);
  const trigger = extra ? requiredComponentTriggerKey(extra.targets, extra.quantities) : "none";
  const requiredQuantities = active
    ? effectiveRequiredQuantities(evaluate(raw, extra).groups.filter((group) => dependentGroups.has(group.groupId)), overrides, trigger)
    : {};
  const configuration = active ? evaluate({ ...raw, ...requiredQuantities }, extra) : first;
  return { configuration, extra, trigger };
}

const kitGroup = (evaluation: { groups: Array<{ groupId: string; visible: boolean; required: boolean; requiredQuantity: number | null; fixedQuantity: number | null; overridden: boolean }> }) => evaluation.groups.find((group) => group.groupId === KIT_GROUP)!;
/** Price comes from template data (item price x active quantity), never from the client. */
const priced = (groups: Array<{ items: Array<{ id: string; price: number }> }>, activeQuantities: Record<string, number>) =>
  groups.flatMap((group) => group.items).reduce((total, item) => total + item.price * (activeQuantities[item.id] ?? 0), 0);

// ---------------------------------------------------------------------------
// Required rule (the Oxi_T case)
// ---------------------------------------------------------------------------

test("required: desk W120 + Modesty Panel W120 x2 shows the kit, required, quantity 2 (client and server agree)", () => {
  const groups = fixture();
  const client = clientEvaluate(groups, desk("desk-120"), { "panel-120": 2 });
  assert.deepEqual(client.extra?.targets, [{ kind: "option_item", group_id: PANEL_GROUP, row_id: "panel-120" }]);
  const kit = kitGroup(client.configuration);
  assert.equal(kit.visible, true);
  assert.equal(kit.required, true);
  assert.equal(kit.requiredQuantity, 2);
  assert.equal(client.configuration.valid, true, JSON.stringify(client.configuration.blockingRequirements));
  assert.deepEqual(client.configuration.activeQuantities, { "panel-120": 2, [KIT_ITEM]: 2 });

  // The client submits only its active quantities; the server runs the same second pass and agrees.
  const server = serverEvaluate(groups, desk("desk-120"), client.configuration.activeQuantities);
  assert.equal(server.evaluation.valid, true, JSON.stringify(server.evaluation.blockingRequirements));
  assert.deepEqual(server.evaluation.activeQuantities, client.configuration.activeQuantities);
  assert.equal(kitGroup(server.evaluation).requiredQuantity, 2);
  // Price comes from template data on the server: panel 2 x 37 + kit 2 x 12.
  assert.equal(priced(groups as never, server.evaluation.activeQuantities), 2 * panelPrice + 2 * kitPrice);
});

test("required: a hand-crafted request without the kit is rejected by the server unless it is an allowed override", () => {
  const groups = fixture();
  const missing = serverEvaluate(groups, desk("desk-120"), { "panel-120": 2 });
  // Required companions may be overridden like Top-Access today (allowRequiredCompanionOverrides), and the difference is reported.
  assert.equal(missing.evaluation.valid, true);
  assert.equal(kitGroup(missing.evaluation).overridden, true);
  assert.equal(kitGroup(missing.evaluation).requiredQuantity, 2);
  const changed = serverEvaluate(groups, desk("desk-120"), { "panel-120": 2, [KIT_ITEM]: 3 });
  assert.equal(changed.evaluation.valid, true);
  assert.equal(kitGroup(changed.evaluation).overridden, true);
});

test("required: the user can change the kit quantity (same override rules as other required companions)", () => {
  const groups = fixture();
  const first = clientEvaluate(groups, desk("desk-120"), { "panel-120": 2 });
  const overrides = { [KIT_ITEM]: { quantity: 1, trigger: first.trigger } };
  const second = clientEvaluate(groups, desk("desk-120"), { "panel-120": 2 }, overrides);
  assert.equal(second.configuration.activeQuantities[KIT_ITEM], 1);
  assert.equal(kitGroup(second.configuration).overridden, true);
  // A changed trigger (panel quantity) drops the stale override and returns to the derived quantity.
  const third = clientEvaluate(groups, desk("desk-120"), { "panel-120": 3 }, overrides);
  assert.equal(third.configuration.activeQuantities[KIT_ITEM], 3);
});

test("no panel selected: the kit is not visible, not required, not priced", () => {
  const groups = fixture();
  const client = clientEvaluate(groups, desk("desk-120"), {});
  const kit = kitGroup(client.configuration);
  assert.equal(kit.visible, false);
  assert.equal(kit.required, false);
  assert.equal(client.configuration.valid, true);
  assert.equal(KIT_ITEM in client.configuration.activeQuantities, false);
  assert.equal(client.extra?.targets.length ?? 0, 0);
  const server = serverEvaluate(groups, desk("desk-120"), {});
  assert.equal(server.evaluation.valid, true);
  assert.equal(priced(groups as never, server.evaluation.activeQuantities), 0);
  // The Desk Extension and panels still behave as before.
  assert.equal(server.evaluation.groups.find((group) => group.groupId === PANEL_GROUP)?.visible, true);
});

test("no panel selected: a kit submitted without a trigger is rejected by the server (no forced or smuggled hardware)", () => {
  const server = serverEvaluate(fixture(), desk("desk-120"), { [KIT_ITEM]: 1 });
  assert.equal(server.evaluation.valid, false);
  assert.equal(server.evaluation.activeQuantities[KIT_ITEM], undefined);
});

test("two trigger items add up: panel W120 x1 + panel W140 x1 gives 2 sets", () => {
  const groups = fixture();
  const client = clientEvaluate(groups, desk("desk-wide"), { "panel-120": 1, "panel-140": 1 });
  assert.equal(kitGroup(client.configuration).requiredQuantity, 2);
  assert.equal(client.configuration.activeQuantities[KIT_ITEM], 2);
  assert.equal(client.extra?.targets.length, 2);
  const server = serverEvaluate(groups, desk("desk-wide"), client.configuration.activeQuantities);
  assert.equal(server.evaluation.valid, true);
  assert.deepEqual(server.evaluation.activeQuantities, client.configuration.activeQuantities);
});

test("stale trigger: when the desk changes and the panel is no longer allowed, the kit disappears and is not priced", () => {
  const groups = fixture();
  const before = clientEvaluate(groups, desk("desk-120"), { "panel-120": 1 });
  assert.equal(before.configuration.activeQuantities[KIT_ITEM], 1);
  // Desk W140 only allows panel W140; the leftover panel W120 (and a leftover kit quantity) are not eligible.
  const after = clientEvaluate(groups, desk("desk-140"), { "panel-120": 1, [KIT_ITEM]: 1 });
  assert.equal("panel-120" in after.configuration.activeQuantities, false);
  assert.equal(KIT_ITEM in after.configuration.activeQuantities, false);
  assert.equal(kitGroup(after.configuration).visible, false);
  assert.equal(priced(groups as never, after.configuration.activeQuantities), 0);
  // The server also refuses the stale panel and never makes the kit visible from it.
  const server = serverEvaluate(groups, desk("desk-140"), { "panel-120": 1, [KIT_ITEM]: 1 });
  assert.equal(server.evaluation.valid, false);
  assert.equal(server.extra, null);
});

// ---------------------------------------------------------------------------
// Optional rule (required: false)
// ---------------------------------------------------------------------------

test("optional rule: the kit group is visible as selectable items, quantity 0 until the user selects it", () => {
  const groups = fixture({ kitRequired: false });
  const client = clientEvaluate(groups, desk("desk-120"), { "panel-120": 2 });
  const kit = kitGroup(client.configuration);
  assert.equal(kit.visible, true);
  assert.equal(kit.required, false);
  assert.equal(client.configuration.activeQuantities[KIT_ITEM], undefined, "not added automatically");
  assert.equal(client.configuration.valid, true);
  assert.equal(kit.fixedQuantity, 2, "the quantity the checkbox applies when the user selects it");

  const selected = clientEvaluate(groups, desk("desk-120"), { "panel-120": 2, [KIT_ITEM]: 2 });
  assert.equal(selected.configuration.valid, true);
  assert.equal(selected.configuration.activeQuantities[KIT_ITEM], 2);
});

test("optional rule: the server accepts the kit only when it is selected, and only with a trigger", () => {
  const groups = fixture({ kitRequired: false });
  const without = serverEvaluate(groups, desk("desk-120"), { "panel-120": 2 });
  assert.equal(without.evaluation.valid, true);
  assert.equal(without.evaluation.activeQuantities[KIT_ITEM], undefined);
  assert.equal(priced(groups as never, without.evaluation.activeQuantities), 2 * panelPrice);

  const withKit = serverEvaluate(groups, desk("desk-120"), { "panel-120": 2, [KIT_ITEM]: 2 });
  assert.equal(withKit.evaluation.valid, true);
  assert.equal(priced(groups as never, withKit.evaluation.activeQuantities), 2 * panelPrice + 2 * kitPrice);

  const noTrigger = serverEvaluate(groups, desk("desk-120"), { [KIT_ITEM]: 1 });
  assert.equal(noTrigger.evaluation.valid, false);
});

// ---------------------------------------------------------------------------
// Gate: nothing changes for templates without ordinary option_item triggers
// ---------------------------------------------------------------------------

test("gate: a template with NO option_item rules makes exactly one evaluation with the old arguments", () => {
  const groups = fixtureWithoutOptionItemRules();
  assert.equal(hasOrdinaryOptionItemRules(asPassGroups(groups)), false);
  assert.equal(ordinaryOptionItemGroupIds(asPassGroups(groups)).size, 0);
  let calls = 0;
  const seen: Array<OptionItemExtraTargets | null> = [];
  const result = evaluateWithOptionItemPass({
    groups: asPassGroups(groups),
    evaluate: (extra) => { calls += 1; seen.push(extra); return evaluateProductAccessorySelection({ accessoryGroups: groups, baseModelGroupId: null, baseModelRowId: null, selectedModelTarget: desk("desk-120"), selectedModelTargets: [desk("desk-120")], selectedQuantities: { "panel-120": 2 }, allowRequiredCompanionOverrides: true }); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(seen, [null]);
  assert.equal(result.extra, null);
  const direct = evaluateProductAccessorySelection({ accessoryGroups: groups, baseModelGroupId: null, baseModelRowId: null, selectedModelTarget: desk("desk-120"), selectedModelTargets: [desk("desk-120")], selectedQuantities: { "panel-120": 2 }, allowRequiredCompanionOverrides: true });
  assert.deepEqual(result.evaluation, direct, "identical result to the single pre-existing evaluation");
  assert.deepEqual(withoutOrdinaryOptionItemDependentQuantities(asPassGroups(groups), { "panel-120": 2 }), { "panel-120": 2 });
});

test("gate: structural_support triggers keep the old path (no new targets, nothing counted twice)", () => {
  const groups = fixture({ panelRole: "structural_support" });
  assert.equal(hasOrdinaryOptionItemRules(asPassGroups(groups)), false, "structural_support triggers do not open the gate");
  assert.equal(ordinaryOptionItemGroupIds(asPassGroups(groups)).size, 0);
  assert.deepEqual(deriveOptionItemTargets({ groups: asPassGroups(groups), activeQuantities: { "panel-120": 2 } }).targets, []);
  let calls = 0;
  const result = evaluateWithOptionItemPass({
    groups: asPassGroups(groups),
    evaluate: () => { calls += 1; return { activeQuantities: { "panel-120": 2 } }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.extra, null);
});

test("gate: a mixed template only derives targets for items WITHOUT the structural_support role", () => {
  const groups = fixture();
  (groups[1].items as Array<{ id: string; role?: string }>)[2].role = "structural_support"; // panel-120 becomes structural support
  const derived = deriveOptionItemTargets({ groups: asPassGroups(groups), activeQuantities: { "panel-120": 1, "panel-140": 1 } });
  assert.deepEqual(derived.targets.map((target) => target.row_id), ["panel-140"], "the structural item is left to the structural path");
});

test("helper: dependent items and groups are reported once", () => {
  const passGroups = asPassGroups(fixture());
  assert.deepEqual([...ordinaryOptionItemGroupIds(passGroups)], [KIT_GROUP]);
  assert.deepEqual([...ordinaryOptionItemDependentItemIds(passGroups)], [KIT_ITEM]);
  assert.deepEqual(withoutOrdinaryOptionItemDependentQuantities(passGroups, { "panel-120": 2, [KIT_ITEM]: 5 }), { "panel-120": 2 });
});

test("helper: a rule that points to an item that does not exist never opens the gate", () => {
  const groups = fixture();
  (groups[2].conditional_configuration!.applicability as Array<{ target: { row_id: string } }>).forEach((rule) => { rule.target.row_id = `missing-${rule.target.row_id}`; });
  assert.equal(hasOrdinaryOptionItemRules(asPassGroups(groups)), false);
});

// ---------------------------------------------------------------------------
// Wiring (selector display and server)
// ---------------------------------------------------------------------------

test("display: the option_item group appears once, in the normal list, and not in the Structural Support block", () => {
  const client = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.ok(client.includes("ordinaryOptionGroupIds.has(group.id) || !group.conditional_configuration?.applicability.some((rule) => rule.target?.kind === \"option_item\")"), "normal list includes ordinary option_item groups");
  assert.ok(client.includes("evaluations={accessoryConfiguration.groups.filter((evaluation) => !ordinaryOptionGroupIds.has(evaluation.groupId))}"), "Structural Support block never repeats them");
  assert.ok(client.includes("ordinaryOptionGroupIds={ordinaryOptionGroupIds}"));
  // Optional companions are listed with the optional items and select at the derived quantity.
  assert.ok(client.includes('evaluation.role === "companion" && !evaluation.required ? "accessory" : evaluation.role'));
  assert.ok(client.includes("evaluation.fixedQuantity !== null ? evaluation.fixedQuantity"));
  // The Structural Support path is untouched.
  assert.ok(client.includes('kind: "option_item" as const'));
  assert.ok(client.indexOf("<StructuralSupportFields") < client.indexOf("{usesVariantPricing ?"));
});

test("wiring: the selector second pass uses the shared helper and its own override trigger", () => {
  const client = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.ok(client.includes('from "@/lib/products/option-item-targets"'));
  assert.ok(client.includes("hasOrdinaryOptionItemRules(optionItemGroups)"));
  assert.ok(client.includes("deriveOptionItemTargets({ groups: optionItemGroups, activeQuantities: firstPassAccessoryConfiguration.activeQuantities })"));
  assert.ok(client.includes("ordinaryOptionDependentItemIds.has(itemId) ? optionItemRequiredTrigger : requiredComponentTrigger"));
  // With the gate off the first pass is the old one: same quantities object, same targets.
  assert.ok(client.includes("optionItemPassEnabled ? withoutOrdinaryOptionItemDependentQuantities(optionItemGroups, templatePricingAccessoryQuantities) : templatePricingAccessoryQuantities"));
});

test("wiring: the server runs the same helper before validating and pricing", () => {
  const server = readFileSync("app/quotations/actions.ts", "utf8");
  assert.ok(server.includes('from "@/lib/products/option-item-targets"'));
  assert.ok(server.includes("evaluateWithOptionItemPass({"));
  assert.ok(server.includes("selectedModelTargets: [...selectedAccessoryModelTargets, ...(extra?.targets ?? [])]"));
  assert.ok(server.includes("}).evaluation;"));
  // Validation and pricing read the final (second pass) evaluation.
  const evaluationIndex = server.indexOf("const accessoryConfiguration = evaluateWithOptionItemPass({");
  assert.ok(evaluationIndex > 0);
  assert.ok(server.indexOf("if (!accessoryConfiguration.valid)", evaluationIndex) > evaluationIndex);
  assert.ok(server.indexOf("new Map(Object.entries(accessoryConfiguration.activeQuantities))", evaluationIndex) > evaluationIndex);
  // The client never decides price: unit prices come from the stored template item.
  assert.ok(server.includes("qty: accessoryPricingQtyById.get(id) ?? 0"));
});
