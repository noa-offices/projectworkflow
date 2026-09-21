import type { BaseModelPricingGroup } from "../products/base-model-pricing-groups";
import { baseModelPricingSubgroupForRow } from "../products/base-model-pricing-subgroups";
import { isSystemBaseRow } from "./native-system-base";

type Row = { id?: string; role?: "system_base" };

export function guidedBaseModelSelection<TRow extends Row>(groups: BaseModelPricingGroup<TRow>[], groupId: string, subgroupId: string) {
  const found = groups.find((item) => item.id === groupId) ?? groups[0] ?? null;
  // System / Base rows are selected in their own selector and are never Main Product / Model rows.
  const group = found && found.items.some(isSystemBaseRow) ? { ...found, items: found.items.filter((row) => !isSystemBaseRow(row)) } : found;
  const subgroups = group ? [...(group.subgroups ?? [])].filter((subgroup) => subgroup.is_active).sort((a, b) => a.sort_order - b.sort_order) : [];
  const ungrouped = group?.items.filter((row) => row.id && !baseModelPricingSubgroupForRow(group, row.id)) ?? [];
  const resolvedSubgroupId = subgroups.length === 1 && !ungrouped.length ? subgroups[0].id : subgroupId;
  const rows = !group ? [] : resolvedSubgroupId ? group.items.filter((row) => row.id && (resolvedSubgroupId === "__ungrouped__" ? !baseModelPricingSubgroupForRow(group, row.id) : subgroups.some((subgroup) => subgroup.id === resolvedSubgroupId && subgroup.row_ids.includes(row.id!)))) : subgroups.length ? [] : group.items;
  return { group, rows, subgroups, ungrouped, resolvedSubgroupId };
}
