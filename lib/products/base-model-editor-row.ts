import { defaultCurrency, normalizeCurrency } from "../currencies";
import { parseNullablePricingNumber } from "./nullable-pricing";
import { reviewImportantRequirements } from "./smart-product-review";
import { BASE_MODEL_SYSTEM_ROLE, type BaseModelPricingRow } from "./base-model-pricing-groups";

type EditorRow = BaseModelPricingRow & { importantRequirements?: string[] };

/**
 * Base/Model row as serialized by the Product Template pricing editor into the hidden variant_pricing field.
 * This is a whitelist, so every persisted field must be listed here. `role: "system_base"` is native System / Base
 * identity: dropping it here silently turned every saved System row into an ordinary model on save.
 */
export function normalizeBaseModelEditorRow<TRow extends EditorRow>(row: TRow, index: number) {
  return {
    id: row.id || `variant-${index}`,
    variant_name: typeof row.variant_name === "string" ? row.variant_name.trim() : "",
    display_name: typeof row.display_name === "string" ? row.display_name.trim() : "",
    supplier_price_list_code: typeof row.supplier_price_list_code === "string" ? row.supplier_price_list_code.trim() : "",
    dimension: typeof row.dimension === "string" ? row.dimension.trim() : "",
    price: parseNullablePricingNumber(row.price),
    currency: normalizeCurrency(typeof row.currency === "string" ? row.currency : defaultCurrency),
    specification: typeof row.specification === "string" ? row.specification.trim() : "",
    ...(row.importantRequirements?.length ? { importantRequirements: reviewImportantRequirements(row.importantRequirements.join("\n")) } : {}),
    ...(row.role === BASE_MODEL_SYSTEM_ROLE ? { role: BASE_MODEL_SYSTEM_ROLE } : {}),
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
  };
}
