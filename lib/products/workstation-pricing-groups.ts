import { hasMeaningfulWorkstationPricing } from "./workstation-pricing-state";

export const WORKSTATION_GROUP_PRICING_TYPE = "workstation_group" as const;
export const LEGACY_WORKSTATION_GROUP_ID = "legacy-workstation-main";
export const LEGACY_WORKSTATION_GROUP_NAME = "Workstation Pricing";

export type WorkstationPricingRow = Record<string, unknown> & {
  id?: string;
  is_active?: boolean;
  sort_order?: number;
};

export type WorkstationPricingGroup<TRow extends WorkstationPricingRow = WorkstationPricingRow> = {
  id: string;
  pricing_type: typeof WORKSTATION_GROUP_PRICING_TYPE;
  group_name: string;
  is_active: boolean;
  sort_order: number;
  items: TRow[];
  subgroups?: Array<{ id: string; subgroup_name: string; sort_order: number; is_active: boolean; row_ids: string[] }>;
};

export type NormalizedWorkstationPricingGroup<TRow extends WorkstationPricingRow = WorkstationPricingRow> =
  WorkstationPricingGroup<TRow> & {
    isSyntheticLegacyGroup: boolean;
  };

export type WorkstationPricingContractIssue = {
  code:
    | "duplicate_group_id"
    | "invalid_group_id"
    | "invalid_group_items"
    | "invalid_group_row"
    | "invalid_root"
    | "invalid_root_record"
    | "unsupported_pricing_type";
  message: string;
  path: string;
};

export type NormalizedWorkstationPricing<TRow extends WorkstationPricingRow = WorkstationPricingRow> = {
  groups: NormalizedWorkstationPricingGroup<TRow>[];
  issues: WorkstationPricingContractIssue[];
  sourceKind: "empty" | "grouped" | "invalid" | "legacy" | "mixed";
};

export class WorkstationPricingContractError extends Error {
  readonly issues: WorkstationPricingContractIssue[];

  constructor(issues: WorkstationPricingContractIssue[]) {
    super(issues.map((issue) => issue.message).join(" ") || "Workstation pricing data is invalid.");
    this.name = "WorkstationPricingContractError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cloneRow<TRow extends WorkstationPricingRow>(row: TRow) {
  return { ...row };
}

export function isWorkstationPricingGroupRecord(
  value: unknown,
): value is Record<string, unknown> & { pricing_type: typeof WORKSTATION_GROUP_PRICING_TYPE } {
  return isRecord(value) && value.pricing_type === WORKSTATION_GROUP_PRICING_TYPE;
}

export function workstationPricingRowId(row: WorkstationPricingRow, fallbackIndex: number) {
  return typeof row.id === "string" && row.id ? row.id : `size-${fallbackIndex}`;
}

export function normalizeWorkstationPricing<TRow extends WorkstationPricingRow = WorkstationPricingRow>(
  input: unknown,
): NormalizedWorkstationPricing<TRow> {
  if (!Array.isArray(input)) {
    return {
      groups: [],
      issues: [{
        code: "invalid_root",
        message: "Workstation pricing must use an array root.",
        path: "desking_size_pricing",
      }],
      sourceKind: "invalid",
    };
  }

  if (!input.length) return { groups: [], issues: [], sourceKind: "empty" };

  const issues: WorkstationPricingContractIssue[] = [];
  const explicitGroups: NormalizedWorkstationPricingGroup<TRow>[] = [];
  const legacyRows: TRow[] = [];
  const explicitGroupIds = new Set<string>();

  input.forEach((entry, entryIndex) => {
    const path = `desking_size_pricing[${entryIndex}]`;
    if (!isRecord(entry)) {
      issues.push({
        code: "invalid_root_record",
        message: `Workstation pricing entry ${entryIndex + 1} must be an object.`,
        path,
      });
      return;
    }

    if (!isWorkstationPricingGroupRecord(entry)) {
      if (typeof entry.pricing_type === "string" && entry.pricing_type) {
        issues.push({
          code: "unsupported_pricing_type",
          message: `Workstation pricing entry ${entryIndex + 1} has an unsupported pricing type.`,
          path: `${path}.pricing_type`,
        });
        return;
      }
      legacyRows.push(cloneRow(entry as TRow));
      return;
    }

    const groupId = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!groupId) {
      issues.push({
        code: "invalid_group_id",
        message: `Workstation pricing group ${entryIndex + 1} requires a stable id.`,
        path: `${path}.id`,
      });
    } else if (explicitGroupIds.has(groupId)) {
      issues.push({
        code: "duplicate_group_id",
        message: `Workstation pricing group id '${groupId}' is duplicated.`,
        path: `${path}.id`,
      });
    } else {
      explicitGroupIds.add(groupId);
    }

    if (!Array.isArray(entry.items)) {
      issues.push({
        code: "invalid_group_items",
        message: `Workstation pricing group '${groupId || entryIndex + 1}' must contain an items array.`,
        path: `${path}.items`,
      });
    }

    const items = (Array.isArray(entry.items) ? entry.items : []).flatMap((item, itemIndex) => {
      if (!isRecord(item) || isWorkstationPricingGroupRecord(item)) {
        issues.push({
          code: "invalid_group_row",
          message: `Workstation pricing group '${groupId || entryIndex + 1}' contains an invalid row.`,
          path: `${path}.items[${itemIndex}]`,
        });
        return [];
      }
      return [cloneRow(item as TRow)];
    });

    explicitGroups.push({
      id: groupId,
      pricing_type: WORKSTATION_GROUP_PRICING_TYPE,
      group_name: typeof entry.group_name === "string" && entry.group_name.trim()
        ? entry.group_name
        : LEGACY_WORKSTATION_GROUP_NAME,
      is_active: entry.is_active !== false,
      sort_order: finiteNumber(entry.sort_order, entryIndex),
      items,
      ...(Array.isArray(entry.subgroups) ? { subgroups: entry.subgroups.flatMap((subgroup) => isRecord(subgroup) && typeof subgroup.id === "string" && typeof subgroup.subgroup_name === "string" && Array.isArray(subgroup.row_ids) ? [{ id: subgroup.id, subgroup_name: subgroup.subgroup_name, sort_order: finiteNumber(subgroup.sort_order, 0), is_active: subgroup.is_active !== false, row_ids: subgroup.row_ids.filter((id): id is string => typeof id === "string") }] : []) } : {}),
      isSyntheticLegacyGroup: false,
    });
  });

  if (legacyRows.length && explicitGroupIds.has(LEGACY_WORKSTATION_GROUP_ID)) {
    issues.push({
      code: "duplicate_group_id",
      message: `Workstation pricing group id '${LEGACY_WORKSTATION_GROUP_ID}' conflicts with the synthesized legacy group.`,
      path: "desking_size_pricing",
    });
  }

  const groups: NormalizedWorkstationPricingGroup<TRow>[] = legacyRows.length
    ? [{
        id: LEGACY_WORKSTATION_GROUP_ID,
        pricing_type: WORKSTATION_GROUP_PRICING_TYPE,
        group_name: LEGACY_WORKSTATION_GROUP_NAME,
        is_active: true,
        sort_order: 0,
        items: legacyRows,
        isSyntheticLegacyGroup: true,
      }, ...explicitGroups]
    : explicitGroups;
  const sourceKind = issues.length && !groups.length
    ? "invalid"
    : legacyRows.length && explicitGroups.length
      ? "mixed"
      : legacyRows.length
        ? "legacy"
        : "grouped";

  return { groups, issues, sourceKind };
}

function validWorkstationPricing<TRow extends WorkstationPricingRow>(input: unknown) {
  const normalized = normalizeWorkstationPricing<TRow>(input);
  if (normalized.issues.length) throw new WorkstationPricingContractError(normalized.issues);
  return normalized;
}

export function workstationPricingGroups<TRow extends WorkstationPricingRow = WorkstationPricingRow>(
  input: unknown,
) {
  return validWorkstationPricing<TRow>(input).groups;
}

export function flattenWorkstationPricingRows<TRow extends WorkstationPricingRow = WorkstationPricingRow>(
  input: unknown,
  options: { activeGroupsOnly?: boolean } = {},
) {
  return validWorkstationPricing<TRow>(input).groups
    .filter((group) => !options.activeGroupsOnly || group.is_active)
    .flatMap((group) => group.items.map(cloneRow));
}

export function serializeWorkstationPricingGroups<TRow extends WorkstationPricingRow = WorkstationPricingRow>(
  groups: Array<WorkstationPricingGroup<TRow> | NormalizedWorkstationPricingGroup<TRow>>,
): WorkstationPricingGroup<TRow>[] {
  const normalized = validWorkstationPricing<TRow>(groups);
  return normalized.groups.map((group) => ({
    id: group.id,
    pricing_type: WORKSTATION_GROUP_PRICING_TYPE,
    group_name: group.group_name,
    is_active: group.is_active,
    sort_order: group.sort_order,
    items: group.items.map(cloneRow),
    ...(group.subgroups ? { subgroups: group.subgroups.map((subgroup) => ({ ...subgroup, row_ids: [...subgroup.row_ids] })) } : {}),
  }));
}

export function hasMeaningfulWorkstationPricingData(input: unknown) {
  return hasMeaningfulWorkstationPricing(flattenWorkstationPricingRows(input));
}

export function hasExplicitWorkstationPricingGroupStructure(input: unknown) {
  return validWorkstationPricing(input).groups.some((group) => !group.isSyntheticLegacyGroup);
}
