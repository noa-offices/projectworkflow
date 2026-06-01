export const MODULAR_ITEM_PRICING_TYPE = "modular_item";
export const MODULAR_META_PRICING_TYPE = "modular_meta";

export type ModularCategoryPricingShape = {
  pricing_type?: string | null;
  modular_default_dimension?: string | null;
  modular_default_specification?: string | null;
};

export function isModularItemPricingRow(row: ModularCategoryPricingShape | null | undefined) {
  return row?.pricing_type === MODULAR_ITEM_PRICING_TYPE;
}

export function isModularMetaPricingRow(row: ModularCategoryPricingShape | null | undefined) {
  return row?.pricing_type === MODULAR_META_PRICING_TYPE;
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
  return (Array.isArray(rows) ? rows : []).filter((row): row is T => isModularItemPricingRow(row));
}

export function standardCategoryPricingRows<
  T extends ModularCategoryPricingShape,
>(rows?: T[] | null) {
  return (Array.isArray(rows) ? rows : []).filter(
    (row): row is T => !isModularItemPricingRow(row) && !isModularMetaPricingRow(row),
  );
}
