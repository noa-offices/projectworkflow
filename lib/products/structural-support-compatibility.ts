/**
 * Pure helpers for Structural Support -> Compatible Main Product targeting.
 * Nothing here touches pricing, applicability, or required-companion logic;
 * it only decides which Base/Model groups/subgroups/rows are presented as
 * compatible once one or more structural-support items are selected.
 */
import {
  STRUCTURAL_SUPPORT_COMPATIBLE_TARGET_KINDS,
  structuralSupportCompatibleTargetKey,
  type StructuralSupportCompatibleTarget,
  type StructuralSupportCompatibleTargetKind,
} from "./accessory-conditional-configuration";
import { BASE_MODEL_GROUP_PRICING_TYPE, LEGACY_BASE_MODEL_GROUP_ID, type BaseModelPricingGroup, type BaseModelPricingRow, type BaseModelPricingSubgroup } from "./base-model-pricing-groups";
import { baseModelGroupRouteKey, draftBaseModelGroupIds, draftBaseModelGroupRows, draftUngroupedBaseModelRows } from "./base-model-draft-groups";
import type { ProductTemplateDraft } from "./product-template-draft";

function isValidTarget(target: StructuralSupportCompatibleTarget | undefined | null): target is StructuralSupportCompatibleTarget {
  return Boolean(
    target &&
    STRUCTURAL_SUPPORT_COMPATIBLE_TARGET_KINDS.includes(target.kind as StructuralSupportCompatibleTargetKind) &&
    target.group_id &&
    target.row_id,
  );
}

/**
 * UNION of every selected structural-support item's compatibleTargets, deduplicated.
 * Returns null when no structural-support item is selected, or when every selected
 * item has no compatibleTargets at all -- both cases mean "leave the hierarchy alone".
 */
export function unionStructuralSupportCompatibleTargets(
  selectedStructuralSupportItems: Array<{ compatibleTargets?: StructuralSupportCompatibleTarget[] }>,
): StructuralSupportCompatibleTarget[] | null {
  if (!selectedStructuralSupportItems.length) return null;
  const all = selectedStructuralSupportItems.flatMap((item) => item.compatibleTargets ?? []);
  if (!all.length) return null;
  const byKey = new Map<string, StructuralSupportCompatibleTarget>();
  all.filter(isValidTarget).forEach((target) => byKey.set(structuralSupportCompatibleTargetKey(target), target));
  return [...byKey.values()];
}

/**
 * Filters Base/Model groups down to only rows/subgroups/groups compatible with
 * `compatibleTargets`. `compatibleTargets === null` (no support selected, or the
 * selected support carries no targets) and "every target is unresolved against
 * the current groups" both fall back to the unchanged input -- never hide
 * everything because of stale/dangling metadata.
 */
export function filterCompatibleBaseModelGroups<TRow extends BaseModelPricingRow>(
  groups: BaseModelPricingGroup<TRow>[],
  compatibleTargets: StructuralSupportCompatibleTarget[] | null,
): BaseModelPricingGroup<TRow>[] {
  if (!compatibleTargets || !compatibleTargets.length) return groups;

  const subgroupTargetsByGroup = new Map<string, Set<string>>();
  const rowTargetsByGroup = new Map<string, Set<string>>();
  compatibleTargets.forEach((target) => {
    const bucket = target.kind === "base_model_subgroup" ? subgroupTargetsByGroup : rowTargetsByGroup;
    if (!bucket.has(target.group_id)) bucket.set(target.group_id, new Set());
    bucket.get(target.group_id)!.add(target.row_id);
  });

  let anyResolved = false;
  const filtered = groups.flatMap((group): BaseModelPricingGroup<TRow>[] => {
    const targetedSubgroupIds = subgroupTargetsByGroup.get(group.id) ?? new Set<string>();
    const targetedRowIds = rowTargetsByGroup.get(group.id) ?? new Set<string>();
    if (!targetedSubgroupIds.size && !targetedRowIds.size) return [];

    const existingSubgroupIds = new Set((group.subgroups ?? []).map((subgroup) => subgroup.id));
    const existingRowIds = new Set(group.items.flatMap((item) => typeof item.id === "string" && item.id ? [item.id] : []));
    const resolvedSubgroupIds = new Set([...targetedSubgroupIds].filter((id) => existingSubgroupIds.has(id)));
    const resolvedRowIds = new Set([...targetedRowIds].filter((id) => existingRowIds.has(id)));
    if (!resolvedSubgroupIds.size && !resolvedRowIds.size) return [];
    anyResolved = true;

    const keptRowIds = new Set<string>(resolvedRowIds);
    (group.subgroups ?? []).forEach((subgroup) => {
      if (resolvedSubgroupIds.has(subgroup.id)) subgroup.row_ids.forEach((id) => keptRowIds.add(id));
    });

    const items = group.items.filter((item) => typeof item.id === "string" && keptRowIds.has(item.id));
    if (!items.length) return [];

    const subgroups = (group.subgroups ?? [])
      .filter((subgroup) => resolvedSubgroupIds.has(subgroup.id) || subgroup.row_ids.some((id) => keptRowIds.has(id)))
      .map((subgroup) => ({ ...subgroup, row_ids: subgroup.row_ids.filter((id) => keptRowIds.has(id)) }))
      .filter((subgroup) => subgroup.row_ids.length > 0);

    return [{ ...group, items, ...(subgroups.length ? { subgroups } : { subgroups: undefined }) }];
  });

  return anyResolved ? filtered : groups;
}

/**
 * Smart Setup picker commit: turns a flat set of selected Base/Model row ids
 * into compatibleTargets, collapsing a fully-selected subgroup into a single
 * base_model_subgroup target instead of one target per row.
 */
export function collapseStructuralSupportSelection<TRow extends BaseModelPricingRow>(
  groups: BaseModelPricingGroup<TRow>[],
  selectedRowIds: ReadonlySet<string>,
): StructuralSupportCompatibleTarget[] {
  const targets: StructuralSupportCompatibleTarget[] = [];
  groups.forEach((group) => {
    const coveredByFullSubgroup = new Set<string>();
    (group.subgroups ?? []).forEach((subgroup) => {
      if (subgroup.row_ids.length && subgroup.row_ids.every((id) => selectedRowIds.has(id))) {
        targets.push({ kind: "base_model_subgroup", group_id: group.id, row_id: subgroup.id });
        subgroup.row_ids.forEach((id) => coveredByFullSubgroup.add(id));
      }
    });
    group.items.forEach((item) => {
      const rowId = item.id;
      if (typeof rowId !== "string" || !rowId) return;
      if (selectedRowIds.has(rowId) && !coveredByFullSubgroup.has(rowId)) {
        targets.push({ kind: "base_model", group_id: group.id, row_id: rowId });
      }
    });
  });
  return targets;
}

/**
 * Smart Setup picker display: expands stored compatibleTargets back into a flat
 * set of selected row ids (a subgroup target selects all of its current rows),
 * plus the subset of targets that no longer resolve against `groups` (dangling).
 */
export function expandStructuralSupportSelection<TRow extends BaseModelPricingRow>(
  groups: BaseModelPricingGroup<TRow>[],
  compatibleTargets: StructuralSupportCompatibleTarget[],
): { selectedRowIds: Set<string>; unresolvedTargets: StructuralSupportCompatibleTarget[] } {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const selectedRowIds = new Set<string>();
  const unresolvedTargets: StructuralSupportCompatibleTarget[] = [];
  compatibleTargets.forEach((target) => {
    const group = groupsById.get(target.group_id);
    if (!group) { unresolvedTargets.push(target); return; }
    if (target.kind === "base_model") {
      const exists = group.items.some((item) => item.id === target.row_id);
      if (!exists) { unresolvedTargets.push(target); return; }
      selectedRowIds.add(target.row_id);
      return;
    }
    const subgroup = (group.subgroups ?? []).find((entry) => entry.id === target.row_id);
    if (!subgroup) { unresolvedTargets.push(target); return; }
    subgroup.row_ids.forEach((id) => selectedRowIds.add(id));
  });
  return { selectedRowIds, unresolvedTargets };
}

/** Minimal route shape the compatibility picker needs; matches SmartReviewRoute's relevant fields. */
export type StructuralSupportReviewRoute = { key: string; destination: string; groupName: string };

/**
 * Builds the Base/Model group hierarchy the Smart Setup compatibility picker
 * shows, from the reviewed draft's own pricing + routing + subgroup review
 * state -- never inferred from names. Mirrors the existing "Applicable
 * Models" grouping convention (flat legacy rows under base_model:rows, plus
 * any price matrix route that resolved to base_model) but keeps subgroup
 * structure intact instead of flattening to individual choices.
 */
export function structuralSupportReviewBaseModelGroups(
  pricing: Pick<ProductTemplateDraft["pricing"], "baseModelRows" | "priceMatrices">,
  routes: StructuralSupportReviewRoute[],
  subgroups: Record<string, BaseModelPricingSubgroup[]>,
): BaseModelPricingGroup[] {
  const groups: BaseModelPricingGroup[] = [];
  const flatRoute = routes.find((route) => route.key === "base_model:rows");
  const ungroupedRows = draftUngroupedBaseModelRows(pricing);
  if (flatRoute?.destination === "base_model" && ungroupedRows.length) {
    groups.push({
      id: LEGACY_BASE_MODEL_GROUP_ID,
      pricing_type: BASE_MODEL_GROUP_PRICING_TYPE,
      group_name: flatRoute.groupName,
      is_active: true,
      sort_order: 0,
      items: ungroupedRows.map((row) => ({ id: row.id, display_name: row.displayName ?? row.label ?? row.id })),
      ...(subgroups["base_model:rows"]?.length ? { subgroups: subgroups["base_model:rows"] } : {}),
    });
  }
  // Native Base/Model groups: one review group per base_model_group route, only that group's rows.
  routes.forEach((route) => {
    const groupId = draftBaseModelGroupIds(pricing).find((id) => baseModelGroupRouteKey(id) === route.key);
    if (route.destination !== "base_model" || !groupId) return;
    const rows = draftBaseModelGroupRows(pricing, groupId);
    if (!rows.length) return;
    groups.push({
      id: groupId,
      pricing_type: BASE_MODEL_GROUP_PRICING_TYPE,
      group_name: route.groupName,
      is_active: true,
      sort_order: groups.length,
      items: rows.map((row) => ({ id: row.id, display_name: row.displayName ?? row.label ?? row.id, ...(row.role ? { role: row.role } : {}) })),
      ...(subgroups[route.key]?.length ? { subgroups: subgroups[route.key] } : {}),
    });
  });
  pricing.priceMatrices.forEach((matrix) => {
    const route = routes.find((item) => item.key === `matrix:${matrix.id}`);
    if (route?.destination !== "base_model") return;
    groups.push({
      id: matrix.id,
      pricing_type: BASE_MODEL_GROUP_PRICING_TYPE,
      group_name: route.groupName,
      is_active: true,
      sort_order: groups.length,
      items: matrix.rows.map((row) => ({ id: row.id, display_name: row.displayName ?? row.label ?? row.id })),
      ...(subgroups[`matrix:${matrix.id}`]?.length ? { subgroups: subgroups[`matrix:${matrix.id}`] } : {}),
    });
  });
  return groups;
}

export type StructuralSupportUnresolvedCompatibility = {
  groupId: string;
  itemId: string;
  itemLabel: string;
  unresolvedTargets: StructuralSupportCompatibleTarget[];
};

/**
 * Every structural-support item whose explicitly stored compatibleTargets contain
 * at least one target that does not resolve against the current reviewed Base/Model
 * groups/subgroups/rows. An item with no compatibleTargets is never included --
 * absent metadata never blocks Apply.
 */
export function structuralSupportUnresolvedCompatibility(
  draft: Pick<ProductTemplateDraft, "pricing" | "optionGroups">,
  routes: StructuralSupportReviewRoute[],
  subgroups: Record<string, BaseModelPricingSubgroup[]>,
): StructuralSupportUnresolvedCompatibility[] {
  const groups = structuralSupportReviewBaseModelGroups(draft.pricing, routes, subgroups);
  return draft.optionGroups.flatMap((group) =>
    group.items.flatMap((item) => {
      if (item.role !== "structural_support" || !item.compatibleTargets?.length) return [];
      const { unresolvedTargets } = expandStructuralSupportSelection(groups, item.compatibleTargets);
      if (!unresolvedTargets.length) return [];
      return [{ groupId: group.id, itemId: item.id, itemLabel: item.displayName ?? item.label ?? item.id, unresolvedTargets }];
    }),
  );
}
