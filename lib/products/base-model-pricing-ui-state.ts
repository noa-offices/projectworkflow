import {
  BASE_MODEL_GROUP_PRICING_TYPE,
  LEGACY_BASE_MODEL_GROUP_NAME,
  type BaseModelPricingGroup,
  type BaseModelPricingRow,
} from "./base-model-pricing-groups";

export function createBaseModelPricingGroup<TRow extends BaseModelPricingRow>(id: string, sortOrder: number, groupName = LEGACY_BASE_MODEL_GROUP_NAME): BaseModelPricingGroup<TRow> {
  return { id, pricing_type: BASE_MODEL_GROUP_PRICING_TYPE, group_name: groupName, is_active: true, sort_order: sortOrder, items: [] };
}

export function updateBaseModelPricingGroup<TRow extends BaseModelPricingRow>(groups: BaseModelPricingGroup<TRow>[], groupId: string, patch: Partial<Pick<BaseModelPricingGroup<TRow>, "group_name" | "is_active">>) {
  return groups.map((group) => group.id === groupId ? { ...group, ...patch } : group);
}

export function removeBaseModelPricingGroup<TRow extends BaseModelPricingRow>(groups: BaseModelPricingGroup<TRow>[], groupId: string) {
  return groups.filter((group) => group.id !== groupId);
}

export function addBaseModelPricingRow<TRow extends BaseModelPricingRow>(groups: BaseModelPricingGroup<TRow>[], groupId: string, row: TRow) {
  return groups.map((group) => group.id === groupId ? { ...group, items: [...group.items, row] } : group);
}

export function updateBaseModelPricingRow<TRow extends BaseModelPricingRow>(groups: BaseModelPricingGroup<TRow>[], groupId: string, rowIndex: number, patch: Partial<TRow>) {
  return groups.map((group) => group.id === groupId
    ? { ...group, items: group.items.map((row, index) => index === rowIndex ? { ...row, ...patch } : row) }
    : group);
}

export function removeBaseModelPricingRow<TRow extends BaseModelPricingRow>(groups: BaseModelPricingGroup<TRow>[], groupId: string, rowIndex: number) {
  return groups.map((group) => group.id === groupId
    ? (() => { const items = group.items.filter((_, index) => index !== rowIndex); const rowIds = new Set(items.flatMap((row) => typeof row.id === "string" ? [row.id] : [])); return { ...group, items, subgroups: group.subgroups?.map((subgroup) => ({ ...subgroup, row_ids: subgroup.row_ids.filter((id) => rowIds.has(id)) })) }; })()
    : group);
}

export function replaceWholeTemplateBaseModelRows<TRow extends BaseModelPricingRow>(groups: BaseModelPricingGroup<TRow>[], rows: TRow[], replacementGroupId: string) {
  // Flat Smart Setup rows must always land under the caller-supplied id (the legacy group id the
  // applicability targets were built against), never under whatever id the sole pre-existing group
  // happens to carry - that id may be a random UUID from a manual "+ Add Group" click and would
  // silently break every accessory rule that references LEGACY_BASE_MODEL_GROUP_ID.
  if (groups.length === 1) { const rowIds = new Set(rows.flatMap((row) => typeof row.id === "string" ? [row.id] : [])); return [{ ...groups[0], id: replacementGroupId, items: rows, subgroups: groups[0].subgroups?.map((subgroup) => ({ ...subgroup, row_ids: subgroup.row_ids.filter((id) => rowIds.has(id)) })) }]; }
  return [{ ...createBaseModelPricingGroup<TRow>(replacementGroupId, 0), items: rows }];
}

export function replaceWholeTemplateBaseModelPricing<TRow extends BaseModelPricingRow>(
  groups: BaseModelPricingGroup<TRow>[],
  rows: TRow[],
  additionalGroups: BaseModelPricingGroup<TRow>[],
  replacementGroupId: string,
) {
  if (!additionalGroups.length) return replaceWholeTemplateBaseModelRows(groups, rows, replacementGroupId);
  const flatGroups = rows.length ? replaceWholeTemplateBaseModelRows(groups, rows, replacementGroupId) : [];
  return [...flatGroups, ...additionalGroups];
}

export function shouldApplyBaseModelReplacement(replacementVersion: number | undefined, appliedVersion: number | undefined) {
  return replacementVersion !== undefined && replacementVersion !== appliedVersion;
}
