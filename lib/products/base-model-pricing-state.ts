export type BaseModelPricingLike = {
  dimension?: string | null;
  display_name?: string | null;
  price?: number | null;
  specification?: string | null;
  supplier_price_list_code?: string | null;
  variant_name?: string | null;
};

export function hasMeaningfulBaseModelPricing(rows?: BaseModelPricingLike[] | null) {
  return (rows ?? []).some((row) => Boolean(
    row.variant_name?.trim() || row.display_name?.trim() ||
    row.supplier_price_list_code?.trim() || row.dimension?.trim() ||
    row.specification?.trim() || row.price !== null && row.price !== undefined,
  ));
}
