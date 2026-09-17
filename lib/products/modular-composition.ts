import { isDirectModularPricingGroup, modularCompositionRule, modularRowRole, modularSelectionFamily, type ModularCategoryPricingShape, type ModularRole } from "./modular-pricing";

export type ModularCompositionSelection = {
  qty: number;
  roleValue: ModularRole | null;
  rowId: string;
};

export type ModularCompositionIssue = {
  code: "starter_required" | "starter_missing_for_intermediate" | "too_many_starters" | "conflicting_modular_selection_family";
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

/** Validates every direct-priced composition group in one product template, including cross-group selectionFamily exclusivity. */
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
