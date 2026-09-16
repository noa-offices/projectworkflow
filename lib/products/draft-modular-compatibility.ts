import { isDirectModularGroup, type ProductTemplateDraft } from "./product-template-draft";

export function analyzeDraftModularCompatibility(draft: ProductTemplateDraft) {
  const errors: string[] = [];
  const allGroups = draft.pricing.modularGroups;
  // Direct-priced groups carry one scalar price per row and never participate in
  // the shared category-column contract that matrix groups must satisfy.
  const directGroups = allGroups.filter((group) => isDirectModularGroup(group));
  const groups = allGroups.filter((group) => !isDirectModularGroup(group));
  const sharedColumns = groups[0]?.matrix?.columns ?? [];
  const sharedById = new Map(sharedColumns.map((column) => [column.id, column]));
  if (sharedById.size !== sharedColumns.length) errors.push("The first modular group contains duplicate category column IDs.");
  groups.forEach((group) => {
    const columns = group.matrix?.columns ?? [];
    const seen = new Set<string>();
    columns.forEach((column) => {
      if (seen.has(column.id)) errors.push(`Modular group '${group.label ?? group.id}' contains duplicate category column ID '${column.id}'.`);
      seen.add(column.id);
      const shared = sharedById.get(column.id);
      if (!shared) errors.push(`Modular group '${group.label ?? group.id}' has category '${column.label ?? column.id}' outside the shared columns.`);
      else if ((shared.label ?? shared.id) !== (column.label ?? column.id)) errors.push(`Modular category '${column.id}' has conflicting labels.`);
    });
    if (columns.length !== sharedColumns.length) errors.push(`Modular group '${group.label ?? group.id}' has a different category column count.`);
    (group.matrix?.rows ?? []).forEach((row) => {
      const keys = Object.keys(row.prices);
      if (keys.length !== sharedColumns.length || sharedColumns.some((column) => !(column.id in row.prices))) errors.push(`Modular row '${row.label ?? row.id}' does not contain the shared category cells.`);
    });
  });
  return { compatible: errors.length === 0, sharedColumns, groups, directGroups, errors, warnings: [] as string[] };
}
