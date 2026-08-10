import { hasMeaningfulBaseModelPricing } from "./base-model-pricing-state";

export const BASE_MODEL_GROUP_PRICING_TYPE = "base_model_group" as const;
export const LEGACY_BASE_MODEL_GROUP_ID = "legacy-base-model-main";
export const LEGACY_BASE_MODEL_GROUP_NAME = "Base / Model Pricing";

export type BaseModelPricingRow = Record<string, unknown> & {
  id?: string;
  variant_name?: string;
  display_name?: string;
  supplier_price_list_code?: string;
  dimension?: string;
  price?: number | null;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

export type BaseModelPricingGroup<TRow extends BaseModelPricingRow = BaseModelPricingRow> = {
  id: string;
  pricing_type: typeof BASE_MODEL_GROUP_PRICING_TYPE;
  group_name: string;
  is_active: boolean;
  sort_order: number;
  items: TRow[];
};

export type NormalizedBaseModelPricingGroup<TRow extends BaseModelPricingRow = BaseModelPricingRow> =
  BaseModelPricingGroup<TRow> & { isSyntheticLegacyGroup: boolean };

export type BaseModelPricingContractIssue = {
  code:
    | "duplicate_group_id"
    | "invalid_group_id"
    | "invalid_group_items"
    | "invalid_group_metadata"
    | "invalid_group_row"
    | "invalid_row_value"
    | "invalid_root"
    | "invalid_root_record"
    | "unsupported_pricing_type";
  message: string;
  path: string;
};

export type NormalizedBaseModelPricing<TRow extends BaseModelPricingRow = BaseModelPricingRow> = {
  groups: NormalizedBaseModelPricingGroup<TRow>[];
  issues: BaseModelPricingContractIssue[];
  sourceKind: "empty" | "grouped" | "invalid" | "legacy" | "mixed";
};

export class BaseModelPricingContractError extends Error {
  readonly issues: BaseModelPricingContractIssue[];

  constructor(issues: BaseModelPricingContractIssue[]) {
    super(issues.map((issue) => issue.message).join(" ") || "Base / Model pricing data is invalid.");
    this.name = "BaseModelPricingContractError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneRow<TRow extends BaseModelPricingRow>(row: TRow) {
  return { ...row };
}

function validOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function rowValueIssue(row: Record<string, unknown>) {
  const stringFields = [
    "id", "variant_name", "display_name", "supplier_price_list_code",
    "dimension", "currency", "specification",
  ];
  if (stringFields.some((field) => !validOptionalString(row[field]))) return true;
  if (row.price !== undefined && row.price !== null && (typeof row.price !== "number" || !Number.isFinite(row.price))) return true;
  if (row.is_active !== undefined && typeof row.is_active !== "boolean") return true;
  if (row.sort_order !== undefined && (typeof row.sort_order !== "number" || !Number.isFinite(row.sort_order))) return true;
  return false;
}

export function isBaseModelPricingGroupRecord(
  value: unknown,
): value is Record<string, unknown> & { pricing_type: typeof BASE_MODEL_GROUP_PRICING_TYPE } {
  return isRecord(value) && value.pricing_type === BASE_MODEL_GROUP_PRICING_TYPE;
}

export function normalizeBaseModelPricing<TRow extends BaseModelPricingRow = BaseModelPricingRow>(
  input: unknown,
): NormalizedBaseModelPricing<TRow> {
  if (!Array.isArray(input)) {
    return {
      groups: [],
      issues: [{ code: "invalid_root", message: "Base / Model pricing must use an array root.", path: "variant_pricing" }],
      sourceKind: "invalid",
    };
  }
  if (!input.length) return { groups: [], issues: [], sourceKind: "empty" };

  const issues: BaseModelPricingContractIssue[] = [];
  const explicitGroups: NormalizedBaseModelPricingGroup<TRow>[] = [];
  const legacyRows: TRow[] = [];
  const explicitGroupIds = new Set<string>();

  const addRow = (value: unknown, path: string, target: TRow[]) => {
    if (!isRecord(value) || isBaseModelPricingGroupRecord(value) ||
      (typeof value.pricing_type === "string" && Boolean(value.pricing_type))) {
      issues.push({ code: "invalid_group_row", message: "Base / Model pricing contains an invalid row.", path });
      return;
    }
    if (rowValueIssue(value)) {
      issues.push({ code: "invalid_row_value", message: "Base / Model pricing contains a malformed row value.", path });
      return;
    }
    target.push(cloneRow(value as TRow));
  };

  input.forEach((entry, entryIndex) => {
    const path = `variant_pricing[${entryIndex}]`;
    if (!isRecord(entry)) {
      issues.push({ code: "invalid_root_record", message: `Base / Model pricing entry ${entryIndex + 1} must be an object.`, path });
      return;
    }
    if (!isBaseModelPricingGroupRecord(entry)) {
      if (typeof entry.pricing_type === "string" && entry.pricing_type) {
        issues.push({ code: "unsupported_pricing_type", message: `Base / Model pricing entry ${entryIndex + 1} has an unsupported pricing type.`, path: `${path}.pricing_type` });
        return;
      }
      addRow(entry, path, legacyRows);
      return;
    }

    const groupId = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!groupId) {
      issues.push({ code: "invalid_group_id", message: `Base / Model pricing group ${entryIndex + 1} requires a stable id.`, path: `${path}.id` });
    } else if (explicitGroupIds.has(groupId)) {
      issues.push({ code: "duplicate_group_id", message: `Base / Model pricing group id '${groupId}' is duplicated.`, path: `${path}.id` });
    } else {
      explicitGroupIds.add(groupId);
    }
    if (!Array.isArray(entry.items)) {
      issues.push({ code: "invalid_group_items", message: `Base / Model pricing group '${groupId || entryIndex + 1}' must contain an items array.`, path: `${path}.items` });
    }
    if (typeof entry.group_name !== "string" || typeof entry.is_active !== "boolean" ||
      typeof entry.sort_order !== "number" || !Number.isFinite(entry.sort_order)) {
      issues.push({ code: "invalid_group_metadata", message: `Base / Model pricing group '${groupId || entryIndex + 1}' has invalid metadata.`, path });
    }

    const items: TRow[] = [];
    if (Array.isArray(entry.items)) entry.items.forEach((item, itemIndex) => addRow(item, `${path}.items[${itemIndex}]`, items));
    explicitGroups.push({
      id: groupId,
      pricing_type: BASE_MODEL_GROUP_PRICING_TYPE,
      group_name: typeof entry.group_name === "string" ? entry.group_name : LEGACY_BASE_MODEL_GROUP_NAME,
      is_active: entry.is_active !== false,
      sort_order: typeof entry.sort_order === "number" && Number.isFinite(entry.sort_order) ? entry.sort_order : entryIndex,
      items,
      isSyntheticLegacyGroup: false,
    });
  });

  if (legacyRows.length && explicitGroupIds.has(LEGACY_BASE_MODEL_GROUP_ID)) {
    issues.push({
      code: "duplicate_group_id",
      message: `Base / Model pricing group id '${LEGACY_BASE_MODEL_GROUP_ID}' conflicts with the synthesized legacy group.`,
      path: "variant_pricing",
    });
  }

  const groups: NormalizedBaseModelPricingGroup<TRow>[] = legacyRows.length
    ? [{
        id: LEGACY_BASE_MODEL_GROUP_ID,
        pricing_type: BASE_MODEL_GROUP_PRICING_TYPE,
        group_name: LEGACY_BASE_MODEL_GROUP_NAME,
        is_active: true,
        sort_order: 0,
        items: legacyRows,
        isSyntheticLegacyGroup: true,
      }, ...explicitGroups]
    : explicitGroups;
  const sourceKind = issues.length && !groups.length ? "invalid"
    : legacyRows.length && explicitGroups.length ? "mixed"
      : legacyRows.length ? "legacy" : "grouped";
  return { groups, issues, sourceKind };
}

export const normalizeBaseModelPricingGroups = normalizeBaseModelPricing;

function validBaseModelPricing<TRow extends BaseModelPricingRow>(input: unknown) {
  const normalized = normalizeBaseModelPricing<TRow>(input);
  if (normalized.issues.length) throw new BaseModelPricingContractError(normalized.issues);
  return normalized;
}

export function baseModelPricingGroups<TRow extends BaseModelPricingRow = BaseModelPricingRow>(input: unknown) {
  return validBaseModelPricing<TRow>(input).groups;
}

export function flattenBaseModelPricingRows<TRow extends BaseModelPricingRow = BaseModelPricingRow>(
  input: unknown,
  options: { activeGroupsOnly?: boolean } = {},
) {
  return validBaseModelPricing<TRow>(input).groups
    .filter((group) => !options.activeGroupsOnly || group.is_active)
    .flatMap((group) => group.items.map(cloneRow));
}

export function serializeBaseModelPricingGroups<TRow extends BaseModelPricingRow = BaseModelPricingRow>(
  groups: Array<BaseModelPricingGroup<TRow> | NormalizedBaseModelPricingGroup<TRow>>,
): BaseModelPricingGroup<TRow>[] {
  const normalized = validBaseModelPricing<TRow>(groups);
  return normalized.groups.map((group) => ({
    id: group.id,
    pricing_type: BASE_MODEL_GROUP_PRICING_TYPE,
    group_name: group.group_name,
    is_active: group.is_active,
    sort_order: group.sort_order,
    items: group.items.map(cloneRow),
  }));
}

export function hasMeaningfulBaseModelPricingData(input: unknown) {
  return hasMeaningfulBaseModelPricing(flattenBaseModelPricingRows(input));
}

export function hasExplicitBaseModelPricingGroupStructure(input: unknown) {
  return validBaseModelPricing(input).groups.some((group) => !group.isSyntheticLegacyGroup);
}
