import { isDirectModularPricingGroup, isSingleStarterModularGroup, modularCompositionRule, modularExcludesBaseModels, modularRowRole, modularSelectionFamily, type ModularCategoryPricingShape, type ModularRole } from "./modular-pricing";

export type ModularCompositionSelection = {
  qty: number;
  roleValue: ModularRole | null;
  rowId: string;
};

export type ModularCompositionIssue = {
  code: "starter_required" | "starter_missing_for_intermediate" | "too_many_starters" | "conflicting_modular_selection_family" | "modular_and_base_model_selected";
  message: string;
};

const CONFLICTING_SELECTION_FAMILY_MESSAGE = "More than one alternative modular configuration has been selected. Keep only one configuration from this family.";

export type ModularCompositionRule = { minStarters: number; maxStarters: number | null };

/**
 * The only composition rule Phase 2 enforces: starter cardinality plus
 * "intermediates need a starter". Rows without a role stay unconstrained, so
 * ordinary modular groups keep behaving exactly as before.
 */
export function evaluateModularComposition(
  rule: ModularCompositionRule | null,
  selections: ModularCompositionSelection[],
): ModularCompositionIssue | null {
  const selected = selections.filter((selection) => selection.qty > 0);
  const starterCount = selected
    .filter((selection) => selection.roleValue === "starter")
    .reduce((total, selection) => total + selection.qty, 0);
  const intermediateCount = selected
    .filter((selection) => selection.roleValue === "intermediate")
    .reduce((total, selection) => total + selection.qty, 0);

  if (intermediateCount > 0 && starterCount === 0) {
    return { code: "starter_missing_for_intermediate", message: "Select a starter module before adding intermediate modules." };
  }
  if (!rule) return null;
  if (rule.minStarters > 0 && selected.length > 0 && starterCount < rule.minStarters) {
    return { code: "starter_required", message: `This composition requires at least ${rule.minStarters} starter module.` };
  }
  if (rule.maxStarters !== null && starterCount > rule.maxStarters) {
    return { code: "too_many_starters", message: `This composition allows at most ${rule.maxStarters} starter module.` };
  }
  return null;
}

/** Builds composition selections for one runtime modular group from selected quantities. */
export function modularCompositionSelections(
  group: ModularCategoryPricingShape,
  quantityForRow: (rowId: string) => number,
): ModularCompositionSelection[] {
  return (group.items ?? []).map((row, index) => {
    const rowId = (typeof row.id === "string" && row.id) || `modular-row-${index}`;
    return { qty: Math.max(0, Math.trunc(quantityForRow(rowId))), roleValue: modularRowRole(row), rowId };
  });
}

function groupHasSelection(
  group: ModularCategoryPricingShape,
  quantityForRow: (groupId: string, rowId: string) => number,
) {
  return modularCompositionSelections(group, (rowId) => quantityForRow(group.id ?? "", rowId))
    .some((selection) => selection.qty > 0);
}

/**
 * Returns the id of the Direct Modular group currently holding a selection within
 * `family`, or null when no group in that family has a selected quantity yet.
 * Groups without a selectionFamily are never considered — they stay unaffected.
 */
export function activeModularSelectionFamilyGroupId(
  groups: ModularCategoryPricingShape[],
  family: string,
  quantityForRow: (groupId: string, rowId: string) => number,
): string | null {
  const activeGroup = groups.find((group) =>
    isDirectModularPricingGroup(group) &&
    modularSelectionFamily(group) === family &&
    groupHasSelection(group, quantityForRow),
  );
  return activeGroup?.id ?? null;
}

/**
 * Server-authoritative check: at most one Direct Modular group per non-empty
 * selectionFamily may carry a selected quantity in one quotation item. Groups
 * without a selectionFamily, matrix groups, and groups in different families
 * are never constrained by this rule.
 */
export function validateModularSelectionFamilyConflicts(
  groups: ModularCategoryPricingShape[],
  quantityForRow: (groupId: string, rowId: string) => number,
): ModularCompositionIssue | null {
  const families = new Set(
    groups
      .filter((group) => isDirectModularPricingGroup(group))
      .map((group) => modularSelectionFamily(group))
      .filter((family): family is string => family !== null),
  );
  for (const family of families) {
    const activeGroupCount = groups
      .filter((group) => isDirectModularPricingGroup(group) && modularSelectionFamily(group) === family)
      .filter((group) => groupHasSelection(group, quantityForRow))
      .length;
    if (activeGroupCount > 1) {
      return { code: "conflicting_modular_selection_family", message: CONFLICTING_SELECTION_FAMILY_MESSAGE };
    }
  }
  return null;
}

/** Validates every composition group (Direct or Matrix Modular) in one product template, including cross-group selectionFamily exclusivity for Direct Modular. */
export function validateModularCompositionGroups(
  groups: ModularCategoryPricingShape[],
  quantityForRow: (groupId: string, rowId: string) => number,
): ModularCompositionIssue | null {
  for (const group of groups) {
    const rule = modularCompositionRule(group);
    const selections = modularCompositionSelections(group, (rowId) => quantityForRow(group.id ?? "", rowId));
    const issue = evaluateModularComposition(rule, selections);
    if (issue) return issue;
  }
  return validateModularSelectionFamilyConflicts(groups, quantityForRow);
}

export const SINGLE_STARTER_HINT = "Only one starter can be selected. Choosing another replaces it.";
export const BASE_MODEL_DISABLED_NOTE = "A workstation system is selected. Clear it to choose a desk size.";
export const MODULAR_DISABLED_NOTE = "A desk size is selected. Clear it to build a workstation.";
export const MODULAR_AND_BASE_MODEL_MESSAGE = "A workstation system and a desk size cannot be combined. Clear one of them and try again.";

/**
 * Next modular quantity map after the user typed `nextQty` on `rowId`. Only a group whose composition allows
 * exactly one starter (max_starters === 1) changes behaviour: a starter row is clamped to 0 or 1, and choosing
 * one zeroes every other starter row of that group. Every other row and every other group is set as typed.
 */
export function applyModularRowQuantity(
  group: ModularCategoryPricingShape | null | undefined,
  current: Record<string, number>,
  rowId: string,
  nextQty: number,
): Record<string, number> {
  const typed = Math.max(0, Math.trunc(Number.isFinite(nextQty) ? nextQty : 0));
  const rows = group?.items ?? [];
  const rowIdOf = (row: ModularCategoryPricingShape, index: number) => (typeof row.id === "string" && row.id) || `modular-row-${index}`;
  const target = rows.find((row, index) => rowIdOf(row, index) === rowId) ?? null;
  if (!group || !target || !isSingleStarterModularGroup(group) || modularRowRole(target) !== "starter") {
    return { ...current, [rowId]: typed };
  }
  const next = { ...current, [rowId]: Math.min(1, typed) };
  if (next[rowId] > 0) {
    rows.forEach((row, index) => {
      const otherId = rowIdOf(row, index);
      if (otherId !== rowId && modularRowRole(row) === "starter") next[otherId] = 0;
    });
  }
  return next;
}

/** True when at least one active modular group of the template opted in to "one way only". */
export function modularGroupsExcludeBaseModels(groups: ModularCategoryPricingShape[]) {
  return groups.some((group) => group.is_active !== false && modularExcludesBaseModels(group));
}

/**
 * Server-authoritative one-way-only check. Applies only when a modular group opted in
 * (modular_excludes_base_models === true); a template without the flag is never constrained.
 */
export function validateModularBaseModelExclusivity(
  groups: ModularCategoryPricingShape[],
  quantityForRow: (groupId: string, rowId: string) => number,
  baseModelSelected: boolean,
): ModularCompositionIssue | null {
  if (!baseModelSelected || !modularGroupsExcludeBaseModels(groups)) return null;
  const modularSelected = groups.some((group) => modularCompositionSelections(group, (rowId) => quantityForRow(group.id ?? "", rowId)).some((selection) => selection.qty > 0));
  return modularSelected ? { code: "modular_and_base_model_selected", message: MODULAR_AND_BASE_MODEL_MESSAGE } : null;
}
