// The accessory rule setup and accessory prices of the Product Library configurator, shared by the standalone product
// and the linked-product "Edit accessories" popup. Pure: moved here unchanged from the selector.
import { accessoryApplicabilityTargetKey, type AccessoryApplicabilityTarget } from "./accessory-conditional-configuration";
import { deriveOptionItemTargets, hasOrdinaryOptionItemRules, ordinaryOptionItemDependentItemIds, ordinaryOptionItemGroupIds, withoutOrdinaryOptionItemDependentQuantities, type OptionItemExtraTargets, type OptionItemPassGroup } from "./option-item-targets";
import { evaluateProductAccessorySelection } from "../quotations/product-accessory-configuration";
import { effectiveRequiredQuantities, requiredComponentTriggerKey, type RequiredComponentOverrides } from "../quotations/required-component-overrides";

type RuleGroup = { id: string; conditional_configuration?: { applicability: ReadonlyArray<{ target?: { kind: string } | null }> } | null };

export function evaluateAccessoryRules<G extends RuleGroup>({ groups, baseModelGroupId, baseModelRowId, targets, targetQuantities, quantities, overrides }: {
  groups: G[];
  /** The Base / Model row, also passed on its own (legacy rules), as the selector always did. */
  baseModelGroupId: string | null | undefined;
  baseModelRowId: string | null | undefined;
  /** Selected main targets plus selected structural supports, in that order. */
  targets: AccessoryApplicabilityTarget[];
  targetQuantities: Record<string, number>;
  quantities: Record<string, number>;
  overrides: RequiredComponentOverrides;
}) {
  const requiredComponentTrigger = requiredComponentTriggerKey(targets, targetQuantities);
  // option_item rules whose trigger is an ordinary accessory item (for example a Stirrup Kit following each
  // Modesty Panel). The gate is off for every template without such rules, which keeps the old evaluation exactly.
  const optionItemGroups = groups as unknown as OptionItemPassGroup[];
  const optionItemPassEnabled = hasOrdinaryOptionItemRules(optionItemGroups);
  const ordinaryOptionGroupIds = ordinaryOptionItemGroupIds(optionItemGroups);
  const ordinaryOptionDependentItemIds = ordinaryOptionItemDependentItemIds(optionItemGroups);
  const evaluateWith = (selectedQuantities: Record<string, number>, extra: OptionItemExtraTargets | null) => evaluateProductAccessorySelection({
    accessoryGroups: groups,
    baseModelGroupId,
    baseModelRowId,
    selectedModelTarget: targets[0] ?? null,
    selectedModelTargets: [...targets, ...(extra?.targets ?? [])],
    selectedModelTargetQuantities: { ...targetQuantities, ...(extra?.quantities ?? {}) },
    selectedQuantities,
    allowRequiredCompanionOverrides: true,
  });
  const evaluate = (selectedQuantities: Record<string, number>) => evaluateWith(selectedQuantities, null);
  // First pass cannot show dependent groups, so their stale quantities are left out of it.
  const firstPassQuantities = optionItemPassEnabled ? withoutOrdinaryOptionItemDependentQuantities(optionItemGroups, quantities) : quantities;
  // Required companions auto-select at the derived quantity; a manual override made under the current trigger wins.
  const requiredEffectiveQuantities = effectiveRequiredQuantities(evaluate(firstPassQuantities).groups.filter((group) => !groups.some((candidate) => candidate.id === group.groupId && candidate.conditional_configuration?.applicability.some((rule) => rule.target?.kind === "option_item"))), overrides, requiredComponentTrigger);
  const firstPass = evaluate({ ...firstPassQuantities, ...requiredEffectiveQuantities });
  // Second pass: a selected, eligible trigger item (for example a Modesty Panel) makes its dependent group visible.
  const optionItemExtra = optionItemPassEnabled ? deriveOptionItemTargets({ groups: optionItemGroups, activeQuantities: firstPass.activeQuantities }) : null;
  const optionItemPassActive = Boolean(optionItemExtra?.targets.length);
  // Its own trigger key, so a panel change only resets overrides of the companions that follow panels.
  const optionItemRequiredTrigger = optionItemExtra ? requiredComponentTriggerKey(optionItemExtra.targets, optionItemExtra.quantities) : requiredComponentTrigger;
  const optionItemRequiredEffectiveQuantities = optionItemPassActive
    ? effectiveRequiredQuantities(evaluateWith({ ...quantities, ...requiredEffectiveQuantities }, optionItemExtra).groups.filter((group) => ordinaryOptionGroupIds.has(group.groupId)), overrides, optionItemRequiredTrigger)
    : {};
  const configuration = optionItemPassActive
    ? evaluateWith({ ...quantities, ...requiredEffectiveQuantities, ...optionItemRequiredEffectiveQuantities }, optionItemExtra)
    : firstPass;
  return { configuration, requiredComponentTrigger, optionItemRequiredTrigger, ordinaryOptionGroupIds, ordinaryOptionDependentItemIds };
}

/** Target quantities for scaled required rules, in the selector's order. */
export const accessoryTargetQuantityEntries = (entries: Array<[AccessoryApplicabilityTarget, number]>): Record<string, number> =>
  Object.fromEntries(entries.map(([target, quantity]) => [accessoryApplicabilityTargetKey(target), quantity]));

type PriceItem = { id?: string; item_name?: string; price?: number | null; prices?: Record<string, number | null>; unavailable_price_categories?: string[] };
type PriceGroup = { id: string; group_name: string; price_categories?: Array<{ id: string; label: string }>; items: PriceItem[] };

const numberValue = (value: unknown) => { const number = Number(value); return Number.isFinite(number) ? number : 0; };

export function accessoryItemPrice(group: Pick<PriceGroup, "price_categories">, accessory: PriceItem, categoryId?: string) {
  const availableCategories = (group.price_categories ?? []).filter((category) => accessory.prices?.[category.id] !== null && accessory.prices?.[category.id] !== undefined && !accessory.unavailable_price_categories?.includes(category.id));
  const selectedCategory = availableCategories.find((category) => category.id === categoryId) ?? availableCategories[0] ?? null;
  const unitPrice = selectedCategory ? numberValue(accessory.prices?.[selectedCategory.id]) : numberValue(accessory.price);
  return { availableCategories, selectedCategory, unitPrice };
}

/** One line per selected accessory, priced by its chosen price category (else the first available one, else its price). */
export function accessoryPriceLines<G extends PriceGroup>(groups: readonly G[], activeQuantities: Record<string, number>, chosenCategory: (groupId: string, itemId: string) => string | undefined) {
  return groups
    .flatMap((group) =>
      (group.items as G["items"][number][]).map((accessory) => {
        const id = accessory.id ?? accessory.item_name ?? "";
        const { selectedCategory, unitPrice } = accessoryItemPrice(group, accessory, chosenCategory(group.id, id));
        return {
          accessory,
          groupName: group.group_name,
          groupId: group.id,
          selectedCategory,
          unitPrice,
          qty: Math.max(0, Math.trunc(numberValue(activeQuantities[id]))),
        };
      }),
    )
    .filter((line) => line.qty > 0);
}
