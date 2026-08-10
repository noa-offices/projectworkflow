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
    ? { ...group, items: group.items.filter((_, index) => index !== rowIndex) }
    : group);
}

export function replaceWholeTemplateBaseModelRows<TRow extends BaseModelPricingRow>(groups: BaseModelPricingGroup<TRow>[], rows: TRow[], replacementGroupId: string) {
  if (groups.length === 1) return [{ ...groups[0], items: rows }];
  return [{ ...createBaseModelPricingGroup<TRow>(replacementGroupId, 0), items: rows }];
}

export function shouldApplyBaseModelReplacement(replacementVersion: number | undefined, appliedVersion: number | undefined) {
  return replacementVersion !== undefined && replacementVersion !== appliedVersion;
}
