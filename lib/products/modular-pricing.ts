export const MODULAR_ITEM_PRICING_TYPE = "modular_item";
export const MODULAR_META_PRICING_TYPE = "modular_meta";
export const MODULAR_GROUP_PRICING_TYPE = "modular_group";

export type ModularCategoryPricingShape = {
  group_name?: string | null;
  id?: string | null;
  is_active?: boolean | null;
  items?: ModularCategoryPricingShape[] | null;
  pricing_type?: string | null;
  sort_order?: number | null;
  modular_default_dimension?: string | null;
  modular_default_specification?: string | null;
};

export function isModularItemPricingRow(row: ModularCategoryPricingShape | null | undefined) {
  return row?.pricing_type === MODULAR_ITEM_PRICING_TYPE;
}

export function isModularMetaPricingRow(row: ModularCategoryPricingShape | null | undefined) {
  return row?.pricing_type === MODULAR_META_PRICING_TYPE;
}

export function isModularGroupPricingRow(row: ModularCategoryPricingShape | null | undefined) {
  return row?.pricing_type === MODULAR_GROUP_PRICING_TYPE;
}

export function modularPricingDefaultsFromRows<
  T extends ModularCategoryPricingShape,
>(rows?: T[] | null) {
  const metaRow = (Array.isArray(rows) ? rows : []).find((row) => isModularMetaPricingRow(row)) ?? null;

  return {
    defaultDimension:
      typeof metaRow?.modular_default_dimension === "string" && metaRow.modular_default_dimension.trim()
        ? metaRow.modular_default_dimension.trim()
        : null,
    defaultSpecification:
      typeof metaRow?.modular_default_specification === "string" && metaRow.modular_default_specification.trim()
        ? metaRow.modular_default_specification.trim()
        : null,
  };
}

export function modularItemPricingRows<
  T extends ModularCategoryPricingShape,
>(rows?: T[] | null) {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (isModularItemPricingRow(row)) {
      return [row];
    }

    if (isModularGroupPricingRow(row)) {
      return (Array.isArray(row.items) ? row.items : []).filter((item): item is T =>
        isModularItemPricingRow(item) || !item?.pricing_type,
      ).map((item) => ({
        ...item,
        pricing_type: MODULAR_ITEM_PRICING_TYPE,
      }));
    }

    return [];
  });
}

export function modularItemPricingGroups<
  T extends ModularCategoryPricingShape,
>(rows?: T[] | null) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const explicitGroups = sourceRows
    .filter((row): row is T => isModularGroupPricingRow(row))
    .map((group, groupIndex) => ({
      ...group,
      id: typeof group.id === "string" && group.id ? group.id : `modular-group-${groupIndex}`,
      group_name:
        typeof group.group_name === "string" && group.group_name.trim()
          ? group.group_name.trim()
          : "Modular Items",
      is_active: group.is_active !== false,
      pricing_type: MODULAR_GROUP_PRICING_TYPE,
      items: (Array.isArray(group.items) ? group.items : []).filter((item): item is T =>
        isModularItemPricingRow(item) || !item?.pricing_type,
      ).map((item) => ({
        ...item,
        pricing_type: MODULAR_ITEM_PRICING_TYPE,
      })),
    }));

  if (explicitGroups.length) {
    return explicitGroups;
  }

  const flatRows = sourceRows.filter((row): row is T => isModularItemPricingRow(row));
  if (!flatRows.length) {
    return [];
  }

  return [{
    id: "modular-group-default",
    group_name: "Modular Items",
    is_active: true,
    pricing_type: MODULAR_GROUP_PRICING_TYPE,
    items: flatRows,
  }];
}

export function standardCategoryPricingRows<
  T extends ModularCategoryPricingShape,
>(rows?: T[] | null) {
  return (Array.isArray(rows) ? rows : []).filter(
    (row): row is T => !isModularItemPricingRow(row) && !isModularMetaPricingRow(row) && !isModularGroupPricingRow(row),
  );
}
