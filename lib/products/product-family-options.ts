// "Choose Product Family" for a template that has BOTH Base / Model groups and Category / Matrix groups. Pure: it only lists
// and selects families; pricing, targets and saved data stay with the existing helpers.
export const MATRIX_FAMILY_SUFFIX = " (price by category)";
export const MATRIX_FAMILY_MISSING_MESSAGE = "Select a model and a price category.";

export type ProductFamilyKind = "base_model" | "price_matrix";
export type ProductFamilyOption = { key: string; kind: ProductFamilyKind; id: string; label: string };
type BaseFamily = { id: string; group_name: string; sort_order?: number };
type MatrixFamily = { id?: string; group_name?: string; sort_order?: number; is_active?: boolean; items?: { is_active?: boolean }[] };

export const familyKey = (kind: ProductFamilyKind, id: string) => `${kind}:${id}`;
const activeRows = (items?: { is_active?: boolean }[]) => (items ?? []).filter((row) => row.is_active !== false);

/** Matrix groups that can be offered as a family: active, with an id and at least one active row. */
export const usableMatrixFamilies = <T extends MatrixFamily>(groups: readonly T[]) => groups.filter((group) => group.id && group.is_active !== false && activeRows(group.items).length > 0);

/** The mixed list applies only when the template has Base / Model groups AND usable matrix groups (otherwise the existing single-type UI is untouched). */
export function mixedProductFamilies(baseGroups: readonly BaseFamily[], matrixGroups: readonly MatrixFamily[]): boolean {
  return baseGroups.length > 0 && usableMatrixFamilies(matrixGroups).length > 0;
}

/** Both kinds in the saved template order (sort_order, ties keep Base / Model first). A group id that is in both lists appears once, as Base / Model. */
export function productFamilyOptions(baseGroups: readonly BaseFamily[], matrixGroups: readonly MatrixFamily[]): ProductFamilyOption[] {
  const baseIds = new Set(baseGroups.map((group) => group.id));
  const entries = [
    ...baseGroups.map((group, index) => ({ option: { key: familyKey("base_model", group.id), kind: "base_model" as const, id: group.id, label: group.group_name }, order: Number(group.sort_order ?? index), tie: 0, index })),
    ...usableMatrixFamilies(matrixGroups).filter((group) => !baseIds.has(group.id!)).map((group, index) => ({ option: { key: familyKey("price_matrix", group.id!), kind: "price_matrix" as const, id: group.id!, label: `${group.group_name ?? "Category / Matrix"}${MATRIX_FAMILY_SUFFIX}` }, order: Number(group.sort_order ?? index), tie: 1, index })),
  ];
  return entries.sort((a, b) => a.order - b.order || a.tie - b.tie || a.index - b.index).map((entry) => entry.option);
}

/** The chosen family: an explicit valid choice, else the family of an existing selection (restored setup), else the first one. */
export function selectedProductFamily(options: readonly ProductFamilyOption[], explicitKey: string | undefined, selection: { matrixGroupId: string | null; matrixRowSelected: boolean; baseGroupId: string | null }): ProductFamilyOption | null {
  const byKey = (key: string) => options.find((option) => option.key === key) ?? null;
  return (explicitKey ? byKey(explicitKey) : null)
    ?? (selection.matrixRowSelected && selection.matrixGroupId ? byKey(familyKey("price_matrix", selection.matrixGroupId)) : null)
    ?? (selection.baseGroupId ? byKey(familyKey("base_model", selection.baseGroupId)) : null)
    ?? options[0] ?? null;
}
