import { defaultCurrency, normalizeCurrency } from "../currencies";
import {
  parseAccessoryConfigurationGroups,
  serializeAccessoryConfigurationGroups,
  type AccessoryConfigurationGroup,
  type AccessoryConfigurationIssue,
  type AccessoryConfigurationItem,
} from "./accessory-conditional-configuration";
import { baseModelPricingGroups } from "./base-model-pricing-groups";
import { parseNullablePricingNumber } from "./nullable-pricing";

export class AccessoryPricingContractError extends Error {
  constructor(public readonly issues: AccessoryConfigurationIssue[]) {
    super(`Accessory Pricing validation failed: ${issues[0]?.message ?? "Invalid accessory pricing data."}`);
    this.name = "AccessoryPricingContractError";
  }
}

function normalizeItem(row: AccessoryConfigurationItem, index: number) {
  return {
    ...row,
    id: typeof row.id === "string" && row.id ? row.id : `add-on-${index}`,
    item_name: typeof row.item_name === "string" ? row.item_name.trim() : "",
    supplier_price_list_code: typeof row.supplier_price_list_code === "string" ? row.supplier_price_list_code.trim() : "",
    price: parseNullablePricingNumber(row.price),
    currency: normalizeCurrency(typeof row.currency === "string" ? row.currency : defaultCurrency),
    specification: typeof row.specification === "string" ? row.specification.trim() : "",
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
    is_active: row.is_active !== false,
  };
}

function meaningfulItem(row: ReturnType<typeof normalizeItem>) {
  return Boolean(row.item_name || row.supplier_price_list_code || row.price !== null || row.specification);
}

function normalizeGroups(groups: AccessoryConfigurationGroup[]) {
  const groupedRows = groups.filter((row) => row.group_name || row.items);
  const flatRows = groups.filter((row) => !row.group_name && !row.items);
  const normalized = groupedRows.map((row, index) => ({
    ...row,
    id: typeof row.id === "string" && row.id ? row.id : `add-on-group-${index}`,
    group_name: typeof row.group_name === "string" && row.group_name.trim() ? row.group_name.trim() : "Accessories",
    group_is_required: row.group_is_required === true,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
    is_active: row.is_active !== false,
    items: (row.items ?? []).map(normalizeItem).filter(meaningfulItem),
  }));

  if (flatRows.length) {
    normalized.push({
      id: "accessories",
      group_name: "Accessories",
      group_is_required: false,
      sort_order: normalized.length,
      is_active: true,
      items: flatRows.map(normalizeItem).filter(meaningfulItem),
    });
  }

  return normalized.filter((group) => group.items.length);
}

function baseModelReferenceIssues(groups: AccessoryConfigurationGroup[], baseModelPricing: unknown) {
  const identities = new Set(
    baseModelPricingGroups(baseModelPricing).flatMap((group) =>
      group.items.flatMap((row) => typeof row.id === "string" && row.id
        ? [`${group.id}\u0000${row.id}`]
        : []),
    ),
  );
  const issues: AccessoryConfigurationIssue[] = [];
  groups.forEach((group, groupIndex) => {
    group.conditional_configuration?.applicability.forEach((rule, ruleIndex) => {
      if (!identities.has(`${rule.base_model_group_id}\u0000${rule.base_model_row_id}`)) {
        issues.push({
          code: "unknown_base_model_reference",
          message: `Base/Model reference '${rule.base_model_group_id} / ${rule.base_model_row_id}' does not exist in the submitted pricing data.`,
          path: `accessory_pricing[${groupIndex}].conditional_configuration.applicability[${ruleIndex}]`,
        });
      }
    });
  });
  return issues;
}

export function parseAccessoryPricingJson(rawValue: string | null | undefined, baseModelPricing: unknown = []) {
  if (!rawValue) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(rawValue);
  } catch {
    throw new AccessoryPricingContractError([{ code: "invalid_root", message: "Accessory Pricing JSON is invalid.", path: "accessory_pricing" }]);
  }

  const parsed = parseAccessoryConfigurationGroups(raw);
  if (!parsed.valid) throw new AccessoryPricingContractError(parsed.issues);
  const normalized = normalizeGroups(parsed.groups);
  const normalizedContract = parseAccessoryConfigurationGroups(normalized);
  const issues = [...normalizedContract.issues, ...baseModelReferenceIssues(normalizedContract.groups, baseModelPricing)];
  if (issues.length) throw new AccessoryPricingContractError(issues);
  return serializeAccessoryConfigurationGroups(normalizedContract.groups);
}
