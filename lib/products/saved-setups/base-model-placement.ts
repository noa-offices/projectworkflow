/**
 * Where a Base / Model row sits in the CURRENT template: its Product Family (group) and Configuration (subgroup).
 * PURE: ids only, no prices. Used to
 *   - save the two ids with a setup (additive keys),
 *   - re-derive them on replay from the row id (so older setups saved with only variant_row_id still work),
 *   - start the Product Family / Configuration dropdowns from the restored row.
 * subgroupId is "" when the group has no active subgroups, and "__ungrouped__" ("Other Models") when the group has
 * active subgroups but this row is in none of them. That is the value the existing dropdown and engine use.
 */
import { baseModelPricingSubgroupForRow } from "../base-model-pricing-subgroups";
import { activeBaseModelPricingGroups } from "../../quotations/native-system-base";

export const UNGROUPED_SUBGROUP_ID = "__ungrouped__";

type PlacementGroup = {
  id: string;
  items: ReadonlyArray<{ id?: string }>;
  subgroups?: ReadonlyArray<{ id: string; row_ids: string[]; is_active?: boolean }> | null;
};

export type BaseModelPlacement = { groupId: string; subgroupId: string };

export function baseModelPlacement(groups: ReadonlyArray<PlacementGroup>, rowId: string | null | undefined): BaseModelPlacement | null {
  if (!rowId) return null;
  const group = groups.find((item) => item.items.some((row) => row.id === rowId));
  if (!group) return null;
  const subgroup = baseModelPricingSubgroupForRow(group as never, rowId) as { id: string; is_active?: boolean } | null;
  if (subgroup && subgroup.is_active !== false) return { groupId: group.id, subgroupId: subgroup.id };
  const hasActiveSubgroups = (group.subgroups ?? []).some((item) => item.is_active !== false);
  return { groupId: group.id, subgroupId: hasActiveSubgroups ? UNGROUPED_SUBGROUP_ID : "" };
}

/** Same, straight from `product_templates.variant_pricing` (active groups and rows only, like the engine). */
export function baseModelPlacementFromTemplate(variantPricing: unknown, rowId: string | null | undefined): BaseModelPlacement | null {
  // Templates without Base / Model pricing (or with an unreadable root) simply have no placement.
  if (!rowId || !Array.isArray(variantPricing)) return null;
  try {
    return baseModelPlacement(activeBaseModelPricingGroups(variantPricing) as unknown as PlacementGroup[], rowId);
  } catch {
    return null;
  }
}
