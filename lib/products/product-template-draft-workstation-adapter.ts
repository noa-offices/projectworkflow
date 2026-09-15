import type { ProductTemplateDraft } from "./product-template-draft";

export function mapDraftWorkstationRows(draft: ProductTemplateDraft) {
  const warnings: string[] = [];
  const rows = draft.pricing.workstationRows.map((row, index) => {
    const codes = [...row.supplierCodes, ...row.referenceCodes];
    if (codes.length > 1) warnings.push(`Workstation row '${row.label ?? row.id}' contains additional supplier codes that were not mapped automatically. Review manually.`);
    const dimension = row.dimensions;
    const text = dimension?.rawText ?? [dimension?.width, dimension?.depth, dimension?.height].filter((value) => value !== null && value !== undefined).join(" × ") + (dimension?.unit ? ` ${dimension.unit}` : "");
    return { id: row.id, label: row.label ?? row.displayName ?? row.id, supplier_price_list_code: codes[0] ?? "", base_supplier_price_list_code: codes[0] ?? "", length: dimension?.width ?? 0, depth: dimension?.depth ?? 0, height: dimension?.height ?? 0, dimension_unit: dimension?.unit ?? "cm", default_dimension: text, default_price: row.price, additional_price: row.additionalPrice, currency: row.currency ?? undefined, specification: row.specification ?? "", ...(row.importantRequirements?.length ? { importantRequirements: row.importantRequirements } : {}), is_active: true, sort_order: index };
  });
  return { rows, warnings };
}
