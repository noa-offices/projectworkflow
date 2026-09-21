import { BASE_MODEL_SYSTEM_ROLE, type BaseModelPricingGroup, type BaseModelPricingRow, type BaseModelPricingSubgroup } from "./base-model-pricing-groups";

export function createBaseModelPricingSubgroup(id: string, subgroupName: string, sortOrder: number): BaseModelPricingSubgroup {
  if (!id.trim()) throw new Error("Subgroup requires a stable id.");
  return { id, subgroup_name: subgroupName, sort_order: sortOrder, is_active: true, row_ids: [] };
}

export function assignBaseModelRowToSubgroup<TRow extends BaseModelPricingRow>(group: BaseModelPricingGroup<TRow>, rowId: string, subgroupId: string | null) {
  const row = group.items.find((item) => item.id === rowId);
  if (!row) return group;
  // System / Base rows are never Main Product subgroup members.
  if (row.role === BASE_MODEL_SYSTEM_ROLE) return removeRowFromBaseModelSubgroups(group, rowId);
  return { ...group, subgroups: (group.subgroups ?? []).map((subgroup) => ({ ...subgroup, row_ids: subgroup.id === subgroupId ? [...subgroup.row_ids.filter((id) => id !== rowId), rowId] : subgroup.row_ids.filter((id) => id !== rowId) })) };
}

export function removeBaseModelPricingSubgroup<TRow extends BaseModelPricingRow>(group: BaseModelPricingGroup<TRow>, subgroupId: string) {
  return { ...group, subgroups: (group.subgroups ?? []).filter((subgroup) => subgroup.id !== subgroupId) };
}

export function removeRowFromBaseModelSubgroups<TRow extends BaseModelPricingRow>(group: BaseModelPricingGroup<TRow>, rowId: string) {
  return { ...group, subgroups: (group.subgroups ?? []).map((subgroup) => ({ ...subgroup, row_ids: subgroup.row_ids.filter((id) => id !== rowId) })) };
}

export function baseModelPricingSubgroupForRow(group: Pick<BaseModelPricingGroup, "subgroups">, rowId: string) {
  return (group.subgroups ?? []).find((subgroup) => subgroup.row_ids.includes(rowId)) ?? null;
}

export function updateBaseModelPricingSubgroup<TRow extends BaseModelPricingRow>(group: BaseModelPricingGroup<TRow>, subgroupId: string, patch: Partial<Pick<BaseModelPricingSubgroup, "subgroup_name" | "sort_order" | "is_active">>) {
  return { ...group, subgroups: (group.subgroups ?? []).map((subgroup) => subgroup.id === subgroupId ? { ...subgroup, ...patch } : subgroup) };
}

export function baseModelSubgroupReferenceKey(pricingType: string, groupId: string, subgroupId: string) { return `${pricingType}\u0000${groupId}\u0000${subgroupId}`; }

export function baseModelSubgroupImageForRow<T>(group: Pick<BaseModelPricingGroup, "id" | "subgroups">, rowId: string, subgroupImages: Readonly<Record<string, T>>, groupImages: Readonly<Record<string, T>>, rowImages: Readonly<Record<string, T>>) {
  const subgroup = baseModelPricingSubgroupForRow(group, rowId);
  return rowImages[rowId] ?? (subgroup ? subgroupImages[subgroup.id] : undefined) ?? groupImages[group.id];
}

export function persistedBaseModelSubgroupKeys(groups: readonly Pick<BaseModelPricingGroup, "id" | "subgroups">[]) {
  return new Set(groups.flatMap((group) => (group.subgroups ?? []).map((subgroup) => baseModelSubgroupReferenceKey("base_model", group.id, subgroup.id))));
}

export function baseModelPricingSubgroupSections<TRow extends BaseModelPricingRow>(group: BaseModelPricingGroup<TRow>) {
  const subgroups = [...(group.subgroups ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((subgroup) => ({ subgroup, rows: group.items.filter((row) => typeof row.id === "string" && subgroup.row_ids.includes(row.id)) }));
  return { subgroups, systemRows: group.items.filter((row) => row.role === BASE_MODEL_SYSTEM_ROLE), ungroupedRows: group.items.filter((row) => row.role !== BASE_MODEL_SYSTEM_ROLE && (typeof row.id !== "string" || !baseModelPricingSubgroupForRow(group, row.id))) };
}
