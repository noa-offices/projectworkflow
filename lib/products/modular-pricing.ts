export const MODULAR_ITEM_PRICING_TYPE = "modular_item";
export const MODULAR_META_PRICING_TYPE = "modular_meta";
export const MODULAR_GROUP_PRICING_TYPE = "modular_group";

/** Opt-in marker: the group prices rows by one scalar `price`, not category columns. */
export const DIRECT_MODULAR_PRICING_MODE = "direct";
export const MODULAR_ROLES = ["starter", "intermediate", "terminal"] as const;
export type ModularRole = typeof MODULAR_ROLES[number];

export type ModularCompositionShape = {
  min_starters?: number | null;
  max_starters?: number | null;
};

export type ModularCategoryPricingShape = {
  group_name?: string | null;
  id?: string | null;
  is_active?: boolean | null;
  items?: ModularCategoryPricingShape[] | null;
  pricing_type?: string | null;
  sort_order?: number | null;
  modular_default_dimension?: string | null;
  modular_default_specification?: string | null;
  modular_pricing_mode?: string | null;
  modular_composition?: ModularCompositionShape | null;
  modular_role?: string | null;
  modular_selection_family?: string | null;
  price?: number | null;
};

/** Normalized cross-group exclusivity marker: a non-empty trimmed string, or null when absent. */
export function modularSelectionFamily(group: ModularCategoryPricingShape | null | undefined) {
  const family = typeof group?.modular_selection_family === "string" ? group.modular_selection_family.trim() : "";
  return family || null;
}

/** Direct-priced modular groups are opt-in; every legacy group stays matrix-priced. */
export function isDirectModularPricingGroup(group: ModularCategoryPricingShape | null | undefined) {
  return group?.modular_pricing_mode === DIRECT_MODULAR_PRICING_MODE;
}

export function modularRowRole(row: ModularCategoryPricingShape | null | undefined): ModularRole | null {
  const role = typeof row?.modular_role === "string" ? row.modular_role : "";
  return MODULAR_ROLES.includes(role as ModularRole) ? role as ModularRole : null;
}

/** Normalized starter cardinality for a composition group. Applies to both Direct and Matrix Modular groups whenever the source proves starter/intermediate/terminal composition. */
export function modularCompositionRule(group: ModularCategoryPricingShape | null | undefined) {
  const composition = group?.modular_composition;
  if (!composition) return null;
  const min = Number(composition.min_starters);
  const max = composition.max_starters === null || composition.max_starters === undefined ? null : Number(composition.max_starters);
  return {
    minStarters: Number.isInteger(min) && min >= 0 ? min : 0,
    maxStarters: max !== null && Number.isInteger(max) && max >= 1 ? max : null,
  };
}

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
