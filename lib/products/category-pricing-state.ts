export type CategoryPricingLike = {
  dimension?: string | null;
  display_name?: string | null;
  group_name?: string | null;
  items?: CategoryPricingLike[] | null;
  price_categories?: string[] | null;
  prices?: Record<string, number | null> | null;
  specification?: string | null;
  supplier_price_list_code?: string | null;
  variant_name?: string | null;
};

const defaultColumns = new Set(["Cat A", "Cat B", "Cat C", "Cat D"]);

export function hasMeaningfulCategoryPricing(groups?: CategoryPricingLike[] | null) {
  return (groups ?? []).some((group) => {
    const customGroupName = Boolean(group.group_name?.trim() && group.group_name.trim() !== "Finish Category Pricing");
    const customColumn = (group.price_categories ?? []).some((column) => !defaultColumns.has(column));
    return customGroupName || customColumn || (group.items ?? []).some((row) => Boolean(
      row.variant_name?.trim() || row.display_name?.trim() || row.supplier_price_list_code?.trim() ||
      row.dimension?.trim() || row.specification?.trim() || Object.values(row.prices ?? {}).some((price) => price !== null && price !== undefined),
    ));
  });
}
