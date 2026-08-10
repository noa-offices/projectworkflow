import {
  LEGACY_WORKSTATION_GROUP_NAME,
  WORKSTATION_GROUP_PRICING_TYPE,
  type WorkstationPricingGroup,
  type WorkstationPricingRow,
} from "./workstation-pricing-groups";

export function createWorkstationPricingGroup<TRow extends WorkstationPricingRow>(
  id: string,
  sortOrder: number,
  groupName = LEGACY_WORKSTATION_GROUP_NAME,
): WorkstationPricingGroup<TRow> {
  return {
    id,
    pricing_type: WORKSTATION_GROUP_PRICING_TYPE,
    group_name: groupName,
    is_active: true,
    sort_order: sortOrder,
    items: [],
  };
}

export function updateWorkstationPricingGroup<TRow extends WorkstationPricingRow>(
  groups: WorkstationPricingGroup<TRow>[],
  groupId: string,
  patch: Partial<Pick<WorkstationPricingGroup<TRow>, "group_name" | "is_active">>,
) {
  return groups.map((group) => group.id === groupId ? { ...group, ...patch } : group);
}

export function removeWorkstationPricingGroup<TRow extends WorkstationPricingRow>(
  groups: WorkstationPricingGroup<TRow>[],
  groupId: string,
) {
  return groups.filter((group) => group.id !== groupId);
}

export function addWorkstationPricingRow<TRow extends WorkstationPricingRow>(
  groups: WorkstationPricingGroup<TRow>[],
  groupId: string,
  row: TRow,
) {
  return groups.map((group) => group.id === groupId
    ? { ...group, items: [...group.items, row] }
    : group);
}

export function updateWorkstationPricingRow<TRow extends WorkstationPricingRow>(
  groups: WorkstationPricingGroup<TRow>[],
  groupId: string,
  rowIndex: number,
  row: TRow,
) {
  return groups.map((group) => group.id === groupId
    ? { ...group, items: group.items.map((current, index) => index === rowIndex ? row : current) }
    : group);
}

export function removeWorkstationPricingRow<TRow extends WorkstationPricingRow>(
  groups: WorkstationPricingGroup<TRow>[],
  groupId: string,
  rowIndex: number,
) {
  return groups.map((group) => group.id === groupId
    ? { ...group, items: group.items.filter((_, index) => index !== rowIndex) }
    : group);
}

export function replaceWholeTemplateWorkstationRows<TRow extends WorkstationPricingRow>(
  groups: WorkstationPricingGroup<TRow>[],
  rows: TRow[],
  replacementGroupId: string,
) {
  if (groups.length === 1) {
    return [{ ...groups[0], items: rows }];
  }

  return [{
    ...createWorkstationPricingGroup<TRow>(replacementGroupId, 0),
    items: rows,
  }];
}

export function shouldApplyWorkstationReplacement(
  replacementVersion: number | undefined,
  appliedVersion: number | undefined,
) {
  return replacementVersion !== undefined && replacementVersion !== appliedVersion;
}
