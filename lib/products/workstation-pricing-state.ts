export type WorkstationPricingLike = {
  additional_price?: number | null;
  additional_supplier_price_list_code?: string | null;
  base_supplier_price_list_code?: string | null;
  default_dimension?: string | null;
  default_price?: number | null;
  depth?: number | null;
  height?: number | null;
  label?: string | null;
  length?: number | null;
  specification?: string | null;
};

export function hasMeaningfulWorkstationPricing(rows?: WorkstationPricingLike[] | null) {
  return (rows ?? []).some((row) => Boolean(
    row.label?.trim() || row.base_supplier_price_list_code?.trim() ||
    row.additional_supplier_price_list_code?.trim() || row.default_dimension?.trim() ||
    row.specification?.trim() || row.length || row.depth || row.height ||
    row.default_price !== null && row.default_price !== undefined ||
    row.additional_price !== null && row.additional_price !== undefined,
  ));
}
