import { defaultCurrency, normalizeCurrency } from "../currencies";
import { parseNullablePricingNumber } from "./nullable-pricing";
import {
  BaseModelPricingContractError,
  normalizeBaseModelPricing,
  serializeBaseModelPricingGroups,
  type BaseModelPricingRow,
} from "./base-model-pricing-groups";

function normalizeServerBaseModelRow(row: BaseModelPricingRow, index: number) {
  return {
    ...row,
    id: typeof row.id === "string" && row.id ? row.id : `variant-${index}`,
    variant_name: typeof row.variant_name === "string" ? row.variant_name.trim() : "",
    display_name: typeof row.display_name === "string" ? row.display_name.trim() : "",
    supplier_price_list_code: typeof row.supplier_price_list_code === "string" ? row.supplier_price_list_code.trim() : "",
    dimension: typeof row.dimension === "string" ? row.dimension.trim() : "",
    price: parseNullablePricingNumber(row.price),
    currency: normalizeCurrency(typeof row.currency === "string" ? row.currency : defaultCurrency),
    specification: typeof row.specification === "string" ? row.specification.trim() : "",
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
    is_active: row.is_active !== false,
  };
}

function meaningfulRow(row: ReturnType<typeof normalizeServerBaseModelRow>) {
  return Boolean(row.variant_name || row.display_name || row.supplier_price_list_code ||
    row.dimension || row.price !== null || row.specification);
}

export function parseBaseModelPricingJson(rawValue: string | null | undefined) {
  if (!rawValue) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new BaseModelPricingContractError([{
      code: "invalid_root",
      message: "Base / Model pricing JSON is invalid.",
      path: "variant_pricing",
    }]);
  }

  const normalized = normalizeBaseModelPricing(parsed);
  if (normalized.issues.length) throw new BaseModelPricingContractError(normalized.issues);
  const groups = normalized.groups.map((group) => ({
    ...group,
    items: group.items.map(normalizeServerBaseModelRow).filter(meaningfulRow),
  }));
  if (normalized.sourceKind === "legacy") return groups[0]?.items ?? [];
  return serializeBaseModelPricingGroups(groups);
}
