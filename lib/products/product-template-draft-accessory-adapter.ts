import type { ProductTemplateDraft, ProductTemplateDraftOptionGroup } from "./product-template-draft";

function selectionIsSafe(group: ProductTemplateDraftOptionGroup) {
  const { defaultItemIds, maxSelections, minSelections, mode } = group.selection;
  if (defaultItemIds.length || maxSelections !== null) return false;
  return (mode === "optional" && minSelections === 0) ||
    (mode === "choose_multiple" && minSelections === 0) ||
    (mode === "required_choose_at_least_one" && minSelections === 1);
}

export function mapDraftOptionGroupsToAccessories(draft: ProductTemplateDraft) {
  const warnings: string[] = [];
  const errors: string[] = [];
  const groups = draft.optionGroups.flatMap((group, groupIndex) => {
    if (!selectionIsSafe(group)) {
      errors.push(`Option group '${group.label ?? group.id}' was not applied because its selection rule cannot be represented safely by Accessory Pricing.`);
      return [];
    }
    return [{
      id: group.id,
      group_name: group.label ?? group.id,
      group_is_required: group.selection.mode === "required_choose_at_least_one",
      is_active: true,
      sort_order: groupIndex,
      items: group.items.map((item, itemIndex) => {
        const codes = [...item.supplierCodes, ...item.referenceCodes];
        if (codes.length > 1) warnings.push(`Accessory item '${item.label ?? item.displayName ?? item.id}' contains additional supplier/reference codes; only the primary code was applied.`);
        return {
          id: item.id,
          item_name: item.label ?? item.displayName ?? item.id,
          supplier_price_list_code: codes[0] ?? "",
          price: item.price,
          currency: item.currency ?? undefined,
          specification: item.specification ?? "",
          is_active: true,
          sort_order: itemIndex,
        };
      }),
    }];
  });
  return { groups, warnings, errors };
}
