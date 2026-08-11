import type { ProductTemplateDraft } from "./product-template-draft";
import { routeDraftPriceMatrices, type DraftPriceMatrixRoute } from "./product-template-draft-pricing-routing";
export function mapDraftPriceMatricesToCategoryGroups(draft: ProductTemplateDraft, matrixRouting: Record<string, DraftPriceMatrixRoute["kind"]> = {}) {
  const routing = routeDraftPriceMatrices(draft, matrixRouting);
  const warnings: string[] = [...routing.warnings];
  const groups = routing.routes.filter((route) => route.kind === "category_matrix").map((route) => route.matrix).filter((matrix) => {
    const modular = /modular/i.test(matrix.label ?? ""); if (modular) warnings.push(`Price matrix '${matrix.label ?? matrix.id}' was not applied to Finish / Category Pricing because it appears to belong to Modular Pricing.`); return !modular;
  }).map((matrix, groupIndex) => {
    const columns = matrix.columns.map((column) => column.label ?? column.id);
    return { id: matrix.id, group_name: matrix.label ?? matrix.id, price_categories: columns, is_active: true, sort_order: groupIndex, items: matrix.rows.map((row, index) => { const codes = [...row.supplierCodes, ...row.referenceCodes]; if (codes.length > 1) warnings.push(`Finish row '${row.label ?? row.id}' contains additional supplier codes that were not mapped automatically.`); const dimension = row.dimensions; const text = dimension?.rawText ?? [dimension?.width, dimension?.depth, dimension?.height].filter((value) => value !== null && value !== undefined).join(" × ") + (dimension?.unit ? ` ${dimension.unit}` : ""); return { id: row.id, variant_name: row.label ?? row.id, display_name: row.displayName ?? "", supplier_price_list_code: codes[0] ?? "", dimension: text, currency: row.currency ?? undefined, specification: row.specification ?? "", prices: Object.fromEntries(matrix.columns.map((column, columnIndex) => [columns[columnIndex], row.prices[column.id]])), is_active: true, sort_order: index }; }) };
  });
  return { groups, warnings };
}
