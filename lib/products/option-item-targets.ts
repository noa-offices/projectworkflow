import { accessoryApplicabilityTargetKey, type AccessoryApplicabilityTarget } from "./accessory-conditional-configuration";

/**
 * Runtime support for option_item applicability rules whose trigger is an ordinary accessory item
 * (an item that does NOT have the structural_support role), for example a Stirrup Kit that follows
 * every selected Modesty Panel.
 *
 * Structural-support triggers keep their own, older path (the selector's Structural Support block);
 * this module never creates a target for an item with role "structural_support", so the two paths can
 * never produce a target for the same item.
 *
 * Shared by the quotation selector and the add-to-quotation server action so both run the same second pass.
 */
export type OptionItemPassGroup = {
  id?: string | null;
  items?: ReadonlyArray<{ id?: string | null; role?: string | null }> | null;
  conditional_configuration?: {
    applicability?: ReadonlyArray<{ target?: { kind?: string; group_id?: string; row_id?: string } | null }> | null;
  } | null;
};

export type OptionItemExtraTargets = {
  targets: AccessoryApplicabilityTarget[];
  quantities: Record<string, number>;
};

type OrdinaryTrigger = { groupId: string; itemId: string; dependentGroupId: string };

const pairKey = (groupId: string, itemId: string) => `${groupId}\u0000${itemId}`;

/** Every option_item rule whose trigger item exists and is NOT a structural support item. */
function ordinaryTriggers(groups: readonly OptionItemPassGroup[]): OrdinaryTrigger[] {
  const roleByItem = new Map<string, string | null>();
  groups.forEach((group) => (group.items ?? []).forEach((item) => {
    if (group.id && item.id) roleByItem.set(pairKey(group.id, item.id), item.role ?? null);
  }));
  return groups.flatMap((group) => (group.conditional_configuration?.applicability ?? []).flatMap((rule) => {
    const target = rule.target;
    if (!group.id || target?.kind !== "option_item" || !target.group_id || !target.row_id) return [];
    const key = pairKey(target.group_id, target.row_id);
    if (!roleByItem.has(key) || roleByItem.get(key) === "structural_support") return [];
    return [{ groupId: target.group_id, itemId: target.row_id, dependentGroupId: group.id }];
  }));
}

/** The gate: false means the template behaves exactly as before. */
export function hasOrdinaryOptionItemRules(groups: readonly OptionItemPassGroup[]) {
  return ordinaryTriggers(groups).length > 0;
}

/** Groups (for example the Stirrup Kit) that depend on an ordinary accessory item. Empty when the gate is off. */
export function ordinaryOptionItemGroupIds(groups: readonly OptionItemPassGroup[]): Set<string> {
  return new Set(ordinaryTriggers(groups).map((trigger) => trigger.dependentGroupId));
}

/** Item ids that belong to those dependent groups. */
export function ordinaryOptionItemDependentItemIds(groups: readonly OptionItemPassGroup[]): Set<string> {
  const dependent = ordinaryOptionItemGroupIds(groups);
  return new Set(groups.filter((group) => group.id && dependent.has(group.id)).flatMap((group) => (group.items ?? []).flatMap((item) => item.id ? [item.id] : [])));
}

/** Removes quantities of dependent-group items (used for the first pass, where those groups cannot be visible yet). */
export function withoutOrdinaryOptionItemDependentQuantities<T extends Record<string, number>>(groups: readonly OptionItemPassGroup[], quantities: T): Record<string, number> {
  const dependentItemIds = ordinaryOptionItemDependentItemIds(groups);
  if (!dependentItemIds.size) return quantities;
  return Object.fromEntries(Object.entries(quantities).filter(([itemId]) => !dependentItemIds.has(itemId)));
}

/**
 * Second pass: one option_item target per trigger item that is currently selected AND eligible.
 * `activeQuantities` must come from the first evaluation (it only holds selections of visible groups and
 * allowed items), so a trigger that became ineligible after the main row changed creates no target.
 * The target quantity is the trigger's selected quantity (used by scale_with_target_quantity).
 */
export function deriveOptionItemTargets({ groups, activeQuantities }: { groups: readonly OptionItemPassGroup[]; activeQuantities: Record<string, number> }): OptionItemExtraTargets {
  const targets: AccessoryApplicabilityTarget[] = [];
  const quantities: Record<string, number> = {};
  const seen = new Set<string>();
  ordinaryTriggers(groups).forEach((trigger) => {
    const key = pairKey(trigger.groupId, trigger.itemId);
    if (seen.has(key)) return;
    seen.add(key);
    const quantity = Math.trunc(Number(activeQuantities[trigger.itemId]));
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    const target = { kind: "option_item" as const, group_id: trigger.groupId, row_id: trigger.itemId };
    targets.push(target);
    quantities[accessoryApplicabilityTargetKey(target)] = quantity;
  });
  return { targets, quantities };
}

/**
 * Runs the evaluation once; when the gate is on and a trigger is selected and eligible, runs it a second time
 * with the derived option_item targets. With the gate off (or no trigger) exactly one call, `evaluate(null)`,
 * is made, so the result is identical to the pre-existing behaviour.
 */
export function evaluateWithOptionItemPass<E extends { activeQuantities: Record<string, number> }>({ groups, evaluate }: {
  groups: readonly OptionItemPassGroup[];
  evaluate: (extra: OptionItemExtraTargets | null) => E;
}): { evaluation: E; extra: OptionItemExtraTargets | null } {
  const first = evaluate(null);
  if (!hasOrdinaryOptionItemRules(groups)) return { evaluation: first, extra: null };
  const extra = deriveOptionItemTargets({ groups, activeQuantities: first.activeQuantities });
  if (!extra.targets.length) return { evaluation: first, extra: null };
  return { evaluation: evaluate(extra), extra };
}
