export type AccessoryPricingLike = {
  group_is_required?: boolean | null;
  group_name?: string | null;
  is_active?: boolean | null;
  items?: AccessoryPricingLike[] | null;
  item_name?: string | null;
  price?: number | null;
  specification?: string | null;
  supplier_price_list_code?: string | null;
};

export function hasMeaningfulAccessoryPricing(groups?: AccessoryPricingLike[] | null) {
  return (groups ?? []).some((group) => {
    const customGroupName = Boolean(group.group_name?.trim() && group.group_name.trim() !== "Accessories");
    const changedGroupRule = group.group_is_required === true || group.is_active === false;
    return customGroupName || changedGroupRule || (group.items ?? []).some((item) => Boolean(
      item.item_name?.trim() || item.supplier_price_list_code?.trim() || item.specification?.trim() ||
      item.price !== null && item.price !== undefined || item.is_active === false,
    ));
  });
}
