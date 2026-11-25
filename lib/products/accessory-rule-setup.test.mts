import assert from "node:assert/strict";
import test from "node:test";
import { accessoryApplicabilityTargetKey, type AccessoryApplicabilityTarget } from "./accessory-conditional-configuration";
import { accessoryPriceLines, evaluateAccessoryRules } from "./accessory-rule-setup";
import { deriveOptionItemTargets, hasOrdinaryOptionItemRules, ordinaryOptionItemDependentItemIds, ordinaryOptionItemGroupIds, withoutOrdinaryOptionItemDependentQuantities, type OptionItemExtraTargets, type OptionItemPassGroup } from "./option-item-targets";
import { evaluateProductAccessorySelection } from "../quotations/product-accessory-configuration";
import { effectiveRequiredQuantities, requiredComponentTriggerKey, type RequiredComponentOverrides } from "../quotations/required-component-overrides";
import { allowedFor, ALL_GROUPS, FELT, itemId, rule, targetsOf } from "./testing/universal-screen-rules-fixture";

type Groups = Array<Record<string, unknown> & { id: string; group_name: string; items: Array<Record<string, unknown> & { id?: string; item_name?: string }>; conditional_configuration?: Record<string, unknown> & { applicability: Array<Record<string, unknown> & { target?: { kind: string } }> } }>;

/**
 * The standalone code exactly as it was on main (product-library-selector.tsx, before this change), copied verbatim
 * apart from turning the closure variables into parameters. The shared function must give the same answers.
 */
function mainSelectorReference(input: { groups: Groups; usesVariantPricing: boolean; variantGroupId: string | null; variantRowId: string | null; targets: AccessoryApplicabilityTarget[]; targetQuantities: Record<string, number>; quantities: Record<string, number>; overrides: RequiredComponentOverrides; categories: Record<string, string>; templateId: string }) {
  const { groups: allAccessoryGroups, usesVariantPricing, targets: selectedAccessoryModelTargets, targetQuantities: accessoryTargetQuantities, quantities: templatePricingAccessoryQuantities, overrides: templateRequiredOverrides, categories: selectedAccessoryCategories, templateId } = input;
  const selectedVariantGroup = input.variantGroupId ? { id: input.variantGroupId } : null;
  const selectedVariantRow = input.variantRowId ? { id: input.variantRowId } : null;
  const selectedAccessoryModelTarget = selectedAccessoryModelTargets[0] ?? null;
  const numberValue = (value: unknown, fallback = 0) => { const number = Number(value); return Number.isFinite(number) ? number : fallback; };
  // ---- verbatim from main ----
  const requiredComponentTrigger = requiredComponentTriggerKey(selectedAccessoryModelTargets, accessoryTargetQuantities);
  const optionItemGroups = allAccessoryGroups as unknown as OptionItemPassGroup[];
  const optionItemPassEnabled = hasOrdinaryOptionItemRules(optionItemGroups);
  const ordinaryOptionGroupIds = ordinaryOptionItemGroupIds(optionItemGroups);
  const ordinaryOptionDependentItemIds = ordinaryOptionItemDependentItemIds(optionItemGroups);
  const evaluateAccessoriesWith = (selectedQuantities: Record<string, number>, extra: OptionItemExtraTargets | null) => evaluateProductAccessorySelection({
    accessoryGroups: allAccessoryGroups,
    baseModelGroupId: usesVariantPricing ? selectedVariantGroup?.id : null,
    baseModelRowId: usesVariantPricing ? selectedVariantRow?.id : null,
    selectedModelTarget: selectedAccessoryModelTarget,
    selectedModelTargets: [...selectedAccessoryModelTargets, ...(extra?.targets ?? [])],
    selectedModelTargetQuantities: { ...accessoryTargetQuantities, ...(extra?.quantities ?? {}) },
    selectedQuantities,
    allowRequiredCompanionOverrides: true,
  });
  const evaluateAccessories = (selectedQuantities: Record<string, number>) => evaluateAccessoriesWith(selectedQuantities, null);
  const firstPassQuantities = optionItemPassEnabled ? withoutOrdinaryOptionItemDependentQuantities(optionItemGroups, templatePricingAccessoryQuantities) : templatePricingAccessoryQuantities;
  const requiredEffectiveQuantities = effectiveRequiredQuantities(evaluateAccessories(firstPassQuantities).groups.filter((group) => !allAccessoryGroups.some((candidate) => candidate.id === group.groupId && candidate.conditional_configuration?.applicability.some((rule) => rule.target?.kind === "option_item"))), templateRequiredOverrides, requiredComponentTrigger);
  const firstPassAccessoryConfiguration = evaluateAccessories({ ...firstPassQuantities, ...requiredEffectiveQuantities });
  const optionItemExtra = optionItemPassEnabled ? deriveOptionItemTargets({ groups: optionItemGroups, activeQuantities: firstPassAccessoryConfiguration.activeQuantities }) : null;
  const optionItemPassActive = Boolean(optionItemExtra?.targets.length);
  const optionItemRequiredTrigger = optionItemExtra ? requiredComponentTriggerKey(optionItemExtra.targets, optionItemExtra.quantities) : requiredComponentTrigger;
  const optionItemRequiredEffectiveQuantities = optionItemPassActive
    ? effectiveRequiredQuantities(evaluateAccessoriesWith({ ...templatePricingAccessoryQuantities, ...requiredEffectiveQuantities }, optionItemExtra).groups.filter((group) => ordinaryOptionGroupIds.has(group.groupId)), templateRequiredOverrides, optionItemRequiredTrigger)
    : {};
  const accessoryConfiguration = optionItemPassActive
    ? evaluateAccessoriesWith({ ...templatePricingAccessoryQuantities, ...requiredEffectiveQuantities, ...optionItemRequiredEffectiveQuantities }, optionItemExtra)
    : firstPassAccessoryConfiguration;
  const selectedPricingAccessories = (allAccessoryGroups as unknown as Array<{ id: string; group_name: string; price_categories?: Array<{ id: string; label: string }>; items: Array<{ id?: string; item_name?: string; price?: number | null; prices?: Record<string, number | null>; unavailable_price_categories?: string[] }> }>)
    .flatMap((group) =>
      group.items.map((accessory) => {
        const id = accessory.id ?? accessory.item_name ?? "";
        const categoryKey = `${templateId}:${group.id}:${id}`;
        const availableCategories = (group.price_categories ?? []).filter((category) => accessory.prices?.[category.id] !== null && accessory.prices?.[category.id] !== undefined && !accessory.unavailable_price_categories?.includes(category.id));
        const selectedCategory = availableCategories.find((category) => category.id === selectedAccessoryCategories[categoryKey]) ?? availableCategories[0] ?? null;
        const unitPrice = selectedCategory ? numberValue(accessory.prices?.[selectedCategory.id]) : numberValue(accessory.price);

        return {
          accessory,
          groupName: group.group_name,
          groupId: group.id,
          selectedCategory,
          unitPrice,
          qty: Math.max(0, Math.trunc(numberValue(accessoryConfiguration.activeQuantities[id]))),
        };
      }),
    )
    .filter((line) => line.qty > 0);
  // ---- end verbatim ----
  return { accessoryConfiguration, requiredComponentTrigger, optionItemRequiredTrigger, ordinaryOptionGroupIds, ordinaryOptionDependentItemIds, selectedPricingAccessories };
}

function shared(input: Parameters<typeof mainSelectorReference>[0]) {
  const rules = evaluateAccessoryRules({
    groups: input.groups,
    baseModelGroupId: input.usesVariantPricing ? input.variantGroupId : null,
    baseModelRowId: input.usesVariantPricing ? input.variantRowId : null,
    targets: input.targets,
    targetQuantities: input.targetQuantities,
    quantities: input.quantities,
    overrides: input.overrides,
  });
  const lines = accessoryPriceLines(input.groups as never, rules.configuration.activeQuantities, (groupId, id) => input.categories[`${input.templateId}:${groupId}:${id}`]);
  return { accessoryConfiguration: rules.configuration, requiredComponentTrigger: rules.requiredComponentTrigger, optionItemRequiredTrigger: rules.optionItemRequiredTrigger, ordinaryOptionGroupIds: rules.ordinaryOptionGroupIds, ordinaryOptionDependentItemIds: rules.ordinaryOptionDependentItemIds, selectedPricingAccessories: lines };
}

// ---- fixtures (representative shapes; real Oxi_Q and chair data are not in the repo) ----
const item = (id: string, price: number, extra: Record<string, unknown> = {}) => ({ id, item_name: id, price, currency: "EUR", is_active: true, ...extra });

/** Universal Screen: Front Stirrups by desk type (46 targets), plus a 1-item required group on felt panels. */
const universalScreen: Groups = [
  { id: "us-og-front-stirrups-880", group_name: "Front Stirrups", group_is_required: true, is_active: true, sort_order: 0, items: FELT.map((code) => item(itemId(code), code === "883" ? 35 : 20)), conditional_configuration: { role: "accessory", selection: "at_least_one", applicability: Object.keys(ALL_GROUPS).flatMap((groupId) => targetsOf(groupId).map((target) => rule(target, allowedFor(groupId)))) } },
  { id: "us-og-lateral", group_name: "Lateral Stirrups", group_is_required: true, is_active: true, sort_order: 1, items: [item("us-lat-881", 18)], conditional_configuration: { role: "companion", selection: "exactly_one", applicability: targetsOf("felt-lateral").map((target) => ({ target, required: true, visible: true, fixed_quantity: 1 })) } },
  { id: "us-og-optional", group_name: "Optional Items", group_is_required: false, is_active: true, sort_order: 2, items: [item("us-opt-920", 3)] },
];

/** Oxi-style desks: option_item companions that scale with the panel quantity, and an exactly-one choice. */
const desk = (row_id: string): AccessoryApplicabilityTarget => ({ kind: "base_model", group_id: "oxi-desks", row_id });
const oxi: Groups = [
  { id: "oxi-panels", group_name: "Modesty Panels", group_is_required: false, is_active: true, sort_order: 0, items: ["120", "140"].map((w) => item(`panel-${w}`, 37)), conditional_configuration: { role: "accessory", selection: "unrestricted", applicability: [{ target: desk("desk-120"), required: false, visible: true, allowed_item_ids: ["panel-120"] }, { target: desk("desk-140"), required: false, visible: true, allowed_item_ids: ["panel-140"] }] } },
  { id: "oxi-kit", group_name: "Stirrup Kit", group_is_required: true, is_active: true, sort_order: 1, items: [item("stirrup-kit", 12)], conditional_configuration: { role: "companion", selection: "at_least_one", applicability: ["120", "140"].map((w) => ({ target: { kind: "option_item", group_id: "oxi-panels", row_id: `panel-${w}` }, required: true, visible: true, fixed_quantity: 1, scale_with_target_quantity: true })) } },
  { id: "oxi-top", group_name: "Top Access", group_is_required: true, is_active: true, sort_order: 2, items: [item("top-a", 50), item("top-b", 55)], conditional_configuration: { role: "conditional_option", selection: "exactly_one", applicability: [{ target: desk("desk-140"), required: true, visible: true }] } },
];

/** Chair: plain groups, one priced by category, one required. */
const chair: Groups = [
  { id: "chair-arms", group_name: "Armrests", group_is_required: true, is_active: true, sort_order: 0, items: [item("arms-fixed", 30), item("arms-3d", 45)] },
  { id: "chair-fabric", group_name: "Headrest", group_is_required: false, is_active: true, sort_order: 1, price_categories: [{ id: "cat-a", label: "A" }, { id: "cat-b", label: "B" }], items: [item("headrest", 0, { prices: { "cat-a": 40, "cat-b": 48 } }), item("headrest-mesh", 0, { prices: { "cat-a": 30, "cat-b": null } })] },
];

const cases: Array<[string, Parameters<typeof mainSelectorReference>[0]]> = [];
const base = { usesVariantPricing: true, targetQuantities: {}, overrides: {}, categories: {}, templateId: "t" };
for (const target of [...targetsOf("felt-front").slice(0, 2), ...targetsOf("felt-lateral").slice(0, 1), ...targetsOf("mel-front").slice(0, 1), ...targetsOf("us-m-fabric-front").slice(0, 1)]) {
  for (const quantities of [{}, { [itemId("883")]: 1 }, { [itemId("880")]: 2, [itemId("466")]: 1, "us-opt-920": 3 }, { "us-lat-881": 0 }] as Array<Record<string, number>>) {
    cases.push([`Universal Screen ${target.row_id} ${JSON.stringify(quantities)}`, { ...base, groups: universalScreen, variantGroupId: target.kind === "base_model" ? target.group_id : null, variantRowId: target.kind === "base_model" ? target.row_id : null, usesVariantPricing: target.kind === "base_model", targets: [target], quantities }]);
  }
}
cases.push(["Universal Screen, no model", { ...base, groups: universalScreen, variantGroupId: null, variantRowId: null, targets: [], quantities: { [itemId("883")]: 1 } }]);
const laterals = targetsOf("felt-lateral");
cases.push(["Universal Screen, removed required companion (override)", { ...base, groups: universalScreen, variantGroupId: "felt-lateral", variantRowId: laterals[0]!.row_id, targets: [laterals[0]!], quantities: {}, overrides: { "us-lat-881": { quantity: 0, trigger: requiredComponentTriggerKey([laterals[0]!], {}) } } }]);
for (const [deskId, quantities] of [["desk-120", {}], ["desk-120", { "panel-120": 2 }], ["desk-140", { "panel-140": 1, "top-b": 1 }], ["desk-140", { "panel-140": 3, "stirrup-kit": 1 }]] as const) {
  cases.push([`Oxi ${deskId} ${JSON.stringify(quantities)}`, { ...base, groups: oxi, variantGroupId: "oxi-desks", variantRowId: deskId, targets: [desk(deskId)], targetQuantities: { [accessoryApplicabilityTargetKey(desk(deskId))]: 2 }, quantities: { ...quantities } }]);
}
cases.push(["Oxi with an override on the scaled kit", { ...base, groups: oxi, variantGroupId: "oxi-desks", variantRowId: "desk-120", targets: [desk("desk-120")], quantities: { "panel-120": 2 }, overrides: { "stirrup-kit": { quantity: 5, trigger: "anything" } } }]);
for (const [quantities, categories] of [[{}, {}], [{ "arms-3d": 1, headrest: 2 }, {}], [{ "arms-fixed": 1, headrest: 1, "headrest-mesh": 1 }, { "t:chair-fabric:headrest": "cat-b", "t:chair-fabric:headrest-mesh": "cat-b" }]] as const) {
  cases.push([`Chair ${JSON.stringify(quantities)} ${JSON.stringify(categories)}`, { ...base, groups: chair, usesVariantPricing: false, variantGroupId: null, variantRowId: null, targets: [], quantities: { ...quantities }, categories: { ...categories } }]);
}

test(`standalone results are identical to main for ${cases.length} selections (Universal Screen, Oxi-style, chair)`, () => {
  assert.ok(cases.length >= 30);
  for (const [name, input] of cases) assert.deepStrictEqual(shared(structuredClone(input)), mainSelectorReference(structuredClone(input)), name);
});

test("the fixtures exercise required, exactly-one, option-item, override and category-price paths", () => {
  const results = cases.map(([, input]) => shared(input));
  assert.ok(results.some((result) => !result.accessoryConfiguration.valid), "a blocked selection");
  assert.ok(results.some((result) => result.accessoryConfiguration.groups.some((group) => group.overridden)), "an override");
  assert.ok(results.some((result) => result.optionItemRequiredTrigger !== result.requiredComponentTrigger), "the option-item pass");
  assert.ok(results.some((result) => result.selectedPricingAccessories.some((line) => line.selectedCategory?.id === "cat-b" && line.unitPrice === 48)), "a chosen price category");
  assert.ok(results.some((result) => result.selectedPricingAccessories.some((line) => line.accessory.id === itemId("883") && line.unitPrice === 35)));
});
