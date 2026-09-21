import { accessoryApplicabilityTargetKey, type AccessoryApplicabilityTarget, type AccessoryGroupEvaluation } from "../products/accessory-conditional-configuration";

/**
 * Required companion quantities: the RECOMMENDED quantity is derived from the configuration rules
 * (`AccessoryGroupEvaluation.requiredQuantity`); the SELECTED quantity is user state. A manual override
 * (quantity change or untick to 0) is remembered together with the trigger it was made under and is only
 * honored while that trigger (selected Main/System rows, their quantities) is unchanged.
 */
export type RequiredComponentOverride = { quantity: number; trigger: string };
export type RequiredComponentOverrides = Record<string, RequiredComponentOverride>;

export function requiredComponentTriggerKey(targets: readonly AccessoryApplicabilityTarget[], targetQuantities: Record<string, number>): string {
  const keys = targets.map((target) => accessoryApplicabilityTargetKey(target)).sort();
  return JSON.stringify([keys, keys.map((key) => Number(targetQuantities[key] ?? 1))]);
}

/** Single-item required companion groups whose item is auto-selected at the derived quantity. */
export function requiredCompanionItems(evaluations: readonly AccessoryGroupEvaluation[]): Array<{ itemId: string; groupId: string; requiredQuantity: number }> {
  return evaluations.flatMap((evaluation) => {
    if (!evaluation.visible || evaluation.role !== "companion" || !evaluation.required || evaluation.requiredQuantity === null || evaluation.allowedItemIds.length !== 1) return [];
    return [{ itemId: evaluation.allowedItemIds[0], groupId: evaluation.groupId, requiredQuantity: evaluation.requiredQuantity }];
  });
}

export function effectiveRequiredQuantities(evaluations: readonly AccessoryGroupEvaluation[], overrides: RequiredComponentOverrides, trigger: string): Record<string, number> {
  return Object.fromEntries(requiredCompanionItems(evaluations).map(({ itemId, requiredQuantity }) => {
    const override = overrides[itemId];
    return [itemId, override && override.trigger === trigger ? override.quantity : requiredQuantity] as const;
  }));
}

export function withRequiredOverride(overrides: RequiredComponentOverrides, itemId: string, quantity: number, trigger: string): RequiredComponentOverrides {
  return { ...overrides, [itemId]: { quantity: Math.max(0, Math.trunc(quantity) || 0), trigger } };
}

export function withoutRequiredOverride(overrides: RequiredComponentOverrides, itemId: string): RequiredComponentOverrides {
  const next = { ...overrides };
  delete next[itemId];
  return next;
}

/** Overridden required companions for the snapshot / warning: required vs selected, never client prices. */
export function requiredComponentOverrideReport(evaluations: readonly AccessoryGroupEvaluation[]): Array<{ group_id: string; required_quantity: number; selected_quantity: number }> {
  return evaluations.flatMap((evaluation) => evaluation.overridden && evaluation.requiredQuantity !== null
    ? [{ group_id: evaluation.groupId, required_quantity: evaluation.requiredQuantity, selected_quantity: evaluation.selectedQuantity }]
    : []);
}
