import { normalizeCurrency, defaultCurrency } from "../currencies";
import { parseNullablePricingNumber } from "./nullable-pricing";
import {
  normalizeWorkstationPricing,
  serializeWorkstationPricingGroups,
  WorkstationPricingContractError,
  type WorkstationPricingRow,
} from "./workstation-pricing-groups";

function normalizedServerRow(row: WorkstationPricingRow, index: number) {
  const label = typeof row.label === "string" ? row.label.trim() : "";
  const parsedDimensions = label.split(/\s*x\s*/i).map((part) => Number(part.trim())).filter(Number.isFinite);
  const length = parsedDimensions[0] ?? Number(row.length);
  const depth = parsedDimensions[1] ?? Number(row.depth);
  const height = parsedDimensions[2] ?? Number(row.height);
  const baseCode = typeof row.base_supplier_price_list_code === "string" && row.base_supplier_price_list_code.trim()
    ? row.base_supplier_price_list_code.trim()
    : typeof row.supplier_price_list_code === "string" ? row.supplier_price_list_code.trim() : "";

  return {
    ...row,
    id: typeof row.id === "string" && row.id ? row.id : `size-${index}`,
    label: label || (Number.isFinite(length) && Number.isFinite(depth) && Number.isFinite(height) ? `${length} x ${depth} x ${height}` : ""),
    supplier_price_list_code: baseCode,
    base_supplier_price_list_code: baseCode,
    length: Number.isFinite(length) ? length : 0,
    depth: Number.isFinite(depth) ? depth : 0,
    height: Number.isFinite(height) ? height : 0,
    dimension_unit: typeof row.dimension_unit === "string" && row.dimension_unit.trim() ? row.dimension_unit.trim() : "cm",
    layout_type: row.layout_type === "Cluster" || row.layout_type === "Both" ? row.layout_type : "Linear",
    default_price: parseNullablePricingNumber(row.default_price),
    additional_price: parseNullablePricingNumber(row.additional_price),
    additional_supplier_price_list_code: typeof row.additional_supplier_price_list_code === "string" ? row.additional_supplier_price_list_code.trim() : "",
    currency: normalizeCurrency(typeof row.currency === "string" ? row.currency : defaultCurrency),
    specification: typeof row.specification === "string" ? row.specification.trim() : "",
    default_dimension: typeof row.default_dimension === "string" ? row.default_dimension.trim() : "",
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
    is_active: row.is_active !== false,
  };
}

function meaningfulRow(row: ReturnType<typeof normalizedServerRow>) {
  return Boolean(row.label || row.length > 0 || row.depth > 0 || row.height > 0 ||
    row.default_price !== null || row.additional_price !== null || row.supplier_price_list_code ||
    row.additional_supplier_price_list_code || row.specification || row.default_dimension);
}

export function parseWorkstationPricingJson(rawValue: string | null | undefined) {
  if (!rawValue) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new WorkstationPricingContractError([{
      code: "invalid_root",
      message: "Workstation pricing JSON is invalid.",
      path: "desking_size_pricing",
    }]);
  }

  const normalized = normalizeWorkstationPricing(parsed);
  if (normalized.issues.length) throw new WorkstationPricingContractError(normalized.issues);

  const groups = normalized.groups.map((group) => ({
    ...group,
    items: group.items.map(normalizedServerRow).filter(meaningfulRow),
  }));

  if (normalized.sourceKind === "legacy") return groups[0]?.items ?? [];
  return serializeWorkstationPricingGroups(groups);
}
