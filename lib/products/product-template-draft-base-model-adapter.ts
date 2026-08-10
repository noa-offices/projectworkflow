import type { ProductTemplateDraft } from "./product-template-draft";
export function mapDraftBaseModelRows(draft: ProductTemplateDraft) {
  const warnings: string[] = [];
  const rows = draft.pricing.baseModelRows.map((row, index) => {
    const codes = [...row.supplierCodes, ...row.referenceCodes];
    if (codes.length > 1) warnings.push(`Base/Model row '${row.label ?? row.displayName ?? row.id}' contains ${codes.length} supplier codes; only the primary code was applied.`);
    const dimension = row.dimensions;
    const text = dimension?.rawText ?? [dimension?.diameter !== null && dimension?.diameter !== undefined ? `Ø${dimension.diameter}` : null, dimension?.width, dimension?.depth, dimension?.height].filter((value) => value !== null && value !== undefined).join(" × ") + (dimension?.unit ? ` ${dimension.unit}` : "");
    return { id: row.id, variant_name: row.label ?? row.id, display_name: row.displayName ?? row.label ?? "", supplier_price_list_code: codes[0] ?? "", dimension: text, price: row.price, currency: row.currency ?? undefined, specification: row.specification ?? "", is_active: true, sort_order: index };
  });
  return { rows, warnings };
}
