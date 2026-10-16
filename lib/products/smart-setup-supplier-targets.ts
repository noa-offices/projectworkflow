import { parseSupportedCurrency, type SupportedCurrency } from "../currencies";
import { normalizeManufacturerCode } from "./manufacturer-code";
import { initialPricingDimensionCode } from "./pricing-category-columns";
import { draftModularColumns, draftModularRows, isDirectModularGroup, type ProductTemplateDraft, type ProductTemplateDraftMatrixColumn } from "./product-template-draft";
import type { PriceTarget } from "./supplier-price-contracts";

/** Draft pricing area a transient target came from. */
export type SmartSetupPriceArchitecture = "base_model" | "workstation" | "price_matrix" | "modular_matrix" | "modular_direct" | "option_direct" | "option_category";
export type SmartSetupPriceField = "unit_price" | "default_price" | "additional_price";
export const SMART_SETUP_TEMPLATE_ID = "smart-setup-draft";

/**
 * Minimal reviewed-draft pricing projection: one entry per priced draft cell. It carries the draft row/cell locator and the
 * commercial context the matcher needs, and nothing else. It is transient: never stored and never an authoritative target.
 */
export type SmartSetupPriceCell = {
  locator: string;
  architecture: SmartSetupPriceArchitecture;
  /** "main_product" unless the draft row declares a native role (system_base, modular role, option item role). */
  role: string;
  groupId: string; rowId: string; columnId: string;
  label: string;
  code: string;
  priceField: SmartSetupPriceField;
  price: number | null;
  currency: SupportedCurrency;
  dimension: string;
  dimensionLabel?: string;
};
export type SmartSetupUnsupportedCell = { locator: string; label: string; reason: "missing_supplier_code" | "multiple_supplier_codes" | "missing_currency" | "invalid_price"; detail: string };
export type SmartSetupPriceProjection = { cells: SmartSetupPriceCell[]; unsupported: SmartSetupUnsupportedCell[] };

type Row = { id: string; label: string | null; displayName: string | null; supplierCodes: string[]; currency: SupportedCurrency | null; isActive?: boolean };
const legacy = "legacy";

/** Pure: reviewed draft pricing → transient priced cells. A cell that cannot be represented safely is reported, never guessed. */
export function projectDraftPricing(draft: ProductTemplateDraft): SmartSetupPriceProjection {
  const cells: SmartSetupPriceCell[] = []; const unsupported: SmartSetupUnsupportedCell[] = [];
  const emit = (input: { locator: string; architecture: SmartSetupPriceArchitecture; role?: string; groupId: string; row: Row; columnId?: string; priceField?: SmartSetupPriceField; price: number | null; dimension?: string; dimensionLabel?: string }) => {
    const { row } = input; const label = row.displayName ?? row.label ?? row.id;
    const codes = [...new Set(row.supplierCodes.map((code) => normalizeManufacturerCode(code)).filter(Boolean))];
    if (codes.length !== 1) { unsupported.push({ locator: input.locator, label, reason: codes.length ? "multiple_supplier_codes" : "missing_supplier_code", detail: codes.length ? "More than one supplier code; one is never chosen automatically." : "No supplier code on this priced row." }); return; }
    const currency = parseSupportedCurrency(row.currency ?? draft.defaultCurrency);
    if (!currency) { unsupported.push({ locator: input.locator, label, reason: "missing_currency", detail: "No row or draft currency." }); return; }
    if (input.price !== null && (typeof input.price !== "number" || !Number.isFinite(input.price) || input.price < 0)) { unsupported.push({ locator: input.locator, label, reason: "invalid_price", detail: "Price is not a non-negative number." }); return; }
    cells.push({ locator: input.locator, architecture: input.architecture, role: input.role ?? "main_product", groupId: input.groupId, rowId: row.id, columnId: input.columnId ?? "", label, code: codes[0], priceField: input.priceField ?? "unit_price", price: input.price, currency, dimension: input.dimension ?? "", ...(input.dimensionLabel ? { dimensionLabel: input.dimensionLabel } : {}) });
  };
  const column = (c: ProductTemplateDraftMatrixColumn) => ({ dimension: c.dimensionCode?.trim() || initialPricingDimensionCode(c.label ?? c.id) || c.id, dimensionLabel: c.label?.trim() || undefined });
  const matrixCells = (architecture: SmartSetupPriceArchitecture, prefix: string, groupId: string, columns: ProductTemplateDraftMatrixColumn[], rows: Array<Row & { prices: Record<string, number | null>; unavailableCategoryIds?: string[]; role?: string }>) => {
    for (const row of rows) {
      if (row.isActive === false) continue;
      for (const c of columns) {
        if (!Object.hasOwn(row.prices ?? {}, c.id) || row.unavailableCategoryIds?.includes(c.id)) continue;
        emit({ locator: `${prefix}:${row.id}:${c.id}`, architecture, role: row.role, groupId, row, columnId: c.id, price: row.prices[c.id], ...column(c) });
      }
    }
  };

  for (const row of draft.pricing.baseModelRows) {
    if (row.isActive === false || row.groupIsActive === false) continue;
    const groupId = row.groupId ?? legacy;
    emit({ locator: `base_model:${groupId}:${row.id}`, architecture: "base_model", role: row.role ?? "main_product", groupId, row, price: row.price });
  }
  for (const row of draft.pricing.workstationRows) {
    if (row.isActive === false) continue;
    const groupId = row.groupId ?? legacy;
    emit({ locator: `workstation:${groupId}:${row.id}:default`, architecture: "workstation", groupId, row, priceField: "default_price", price: row.price });
    // The draft carries one supplier code per workstation row; the additional price is checked as the additional_price field of that same code.
    if (row.additionalPrice !== null) emit({ locator: `workstation:${groupId}:${row.id}:additional`, architecture: "workstation", groupId, row, priceField: "additional_price", price: row.additionalPrice });
  }
  for (const matrix of draft.pricing.priceMatrices) {
    if (matrix.isActive === false) continue;
    matrixCells("price_matrix", `price_matrix:${matrix.id}`, matrix.id, matrix.columns, matrix.rows);
  }
  for (const group of draft.pricing.modularGroups) {
    if (group.isActive === false) continue;
    if (isDirectModularGroup(group)) {
      for (const row of draftModularRows(group) as Array<Row & { price: number | null; role?: string }>) {
        if (row.isActive === false) continue;
        emit({ locator: `modular_direct:${group.id}:${row.id}`, architecture: "modular_direct", role: row.role ?? "main_product", groupId: group.id, row, price: row.price });
      }
    } else matrixCells("modular_matrix", `modular_matrix:${group.id}`, group.id, draftModularColumns(group), draftModularRows(group) as never);
  }
  for (const group of draft.optionGroups) {
    if (group.isActive === false) continue;
    const categories = group.priceCategories ?? [];
    for (const item of group.items) {
      if (item.isActive === false) continue;
      if (categories.length && item.prices) {
        for (const c of categories) {
          if (!Object.hasOwn(item.prices, c.id) || item.unavailablePriceCategoryIds?.includes(c.id)) continue;
          emit({ locator: `option:${group.id}:${item.id}:${c.id}`, architecture: "option_category", role: item.role ?? "main_product", groupId: group.id, row: item, columnId: c.id, price: item.prices[c.id], ...column({ id: c.id, label: c.label }) });
        }
      } else emit({ locator: `option:${group.id}:${item.id}`, architecture: "option_direct", role: item.role ?? "main_product", groupId: group.id, row: item, price: item.price });
    }
  }
  return { cells, unsupported };
}

/** Transient PriceTargets for the existing matcher. Not persisted; the key embeds the unique draft locator. */
export function smartSetupCellsToTargets(brandId: string, cells: SmartSetupPriceCell[]): PriceTarget[] {
  return cells.map((cell) => ({
    key: JSON.stringify([SMART_SETUP_TEMPLATE_ID, cell.locator]), template_id: SMART_SETUP_TEMPLATE_ID, template_name: "Smart Setup draft", brand_id: brandId,
    architecture: cell.architecture, group_id: cell.groupId, row_id: cell.rowId, column_id: cell.columnId, dimension: cell.dimension,
    price_field: cell.priceField, physical_field: cell.priceField, code: cell.code, raw_code: cell.code, price: cell.price, currency: cell.currency,
    pricing_version: "draft", label: cell.label, ...(cell.dimensionLabel ? { dimension_label: cell.dimensionLabel } : {}),
  }));
}
