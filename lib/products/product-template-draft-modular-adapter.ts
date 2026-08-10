import { analyzeDraftModularCompatibility } from "./draft-modular-compatibility";
import {
  MODULAR_GROUP_PRICING_TYPE,
  MODULAR_ITEM_PRICING_TYPE,
} from "./modular-pricing";
import type { ProductTemplateDraft, ProductTemplateDraftDimension } from "./product-template-draft";

function dimensionText(value: ProductTemplateDraftDimension | null) {
  if (!value) return "";
  if (value.rawText) return value.rawText;
  const parts = value.diameter !== null
    ? [`Ø${value.diameter}`, value.height]
    : [value.width, value.depth, value.height];
  return parts.filter((part) => part !== null).join(" × ") + (value.unit ? ` ${value.unit}` : "");
}

export function mapDraftModularPricing(draft: ProductTemplateDraft) {
  const analysis = analyzeDraftModularCompatibility(draft);
  const warnings = [...analysis.warnings];
  if (!analysis.compatible) {
    return { compatible: false as const, groups: [], priceCategories: [], warnings, errors: analysis.errors };
  }

  const priceCategories = analysis.sharedColumns.map((column) => column.label ?? column.id);
  const groups = analysis.groups.map((group, groupIndex) => ({
    id: group.id,
    group_name: group.label ?? group.id,
    price_categories: priceCategories,
    pricing_type: MODULAR_GROUP_PRICING_TYPE,
    is_active: true,
    sort_order: groupIndex,
    items: group.matrix.rows.map((row, rowIndex) => {
      const codes = [...row.supplierCodes, ...row.referenceCodes];
      if (codes.length > 1) {
        warnings.push(`Modular row '${row.label ?? row.displayName ?? row.id}' contains additional supplier/reference codes; only the primary code was applied.`);
      }
      return {
        id: row.id,
        pricing_type: MODULAR_ITEM_PRICING_TYPE,
        variant_name: row.label ?? row.id,
        display_name: row.displayName ?? row.label ?? "",
        supplier_price_list_code: codes[0] ?? "",
        dimension: dimensionText(row.dimensions),
        specification: row.specification ?? "",
        currency: row.currency ?? undefined,
        prices: Object.fromEntries(analysis.sharedColumns.map((column, index) => [
          priceCategories[index],
          row.prices[column.id],
        ])),
        is_active: true,
        sort_order: rowIndex,
      };
    }),
  }));

  return { compatible: true as const, groups, priceCategories, warnings, errors: [] as string[] };
}
