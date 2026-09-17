import { defaultCurrency, normalizeCurrency } from "../currencies";
import { groupedStandardCategoryPricingRows, normalizeCategoryPriceLabel } from "./category-pricing-groups";
import {
  MODULAR_GROUP_PRICING_TYPE,
  MODULAR_ITEM_PRICING_TYPE,
  MODULAR_META_PRICING_TYPE,
  MODULAR_ROLES,
  type ModularRole,
} from "./modular-pricing";
import { parseNullablePricingNumber } from "./nullable-pricing";
import { explicitCategoryPriceValue, explicitPricingCategoryLabels, manualDefaultPriceCategories } from "./pricing-category-columns";

/**
 * Rebuilds the save-ready `category_pricing` column from submitted Category/Matrix and Modular
 * FormData JSON. Extracted from the "use server" template actions module (which may only export
 * async functions) so this pure, side-effect-free normalization can be unit tested directly.
 *
 * Matrix Modular groups keep the existing category-price-map normalization unchanged. Direct
 * Modular groups (`modular_pricing_mode: "direct"`) preserve their own scalar `price`,
 * `modular_role`, and group-level `modular_composition` instead of being force-normalized into a
 * fake category price map.
 */
export function categoryPricingValue(rawValue: string, modularRawValue: string, modularDefaultsRawValue: string) {
  if (!rawValue && !modularRawValue && !modularDefaultsRawValue) return [];

  try {
    const parsed = rawValue ? JSON.parse(rawValue) as Array<Record<string, unknown>> : [];
    const parsedModular = modularRawValue ? JSON.parse(modularRawValue) as Array<Record<string, unknown>> : [];
    const modularDefaults = modularDefaultsRawValue
      ? JSON.parse(modularDefaultsRawValue) as Record<string, unknown>
      : {};
    const sourceRows = [
      ...(Array.isArray(parsed) ? parsed : []),
      ...(Array.isArray(parsedModular) ? parsedModular.filter((row) => row?.pricing_type !== MODULAR_GROUP_PRICING_TYPE) : []),
    ];

    const normalizeCategoryRow = (row: Record<string, unknown>, index: number, explicitCategories: string[] = []) => {
      const prices = typeof row.prices === "object" && row.prices !== null
        ? row.prices as Record<string, unknown>
        : {};
      const normalizedPrices = new Map<string, number | null>((explicitCategories.length ? explicitCategories : manualDefaultPriceCategories)
        .map((category) => [category, parseNullablePricingNumber(explicitCategoryPriceValue(prices, category))]));

      if (!explicitCategories.length) Object.entries(prices).forEach(([key, value]) => {
        const label = normalizeCategoryPriceLabel(key);
        if (!label) {
          return;
        }

        normalizedPrices.set(label, parseNullablePricingNumber(value));
      });

      return {
        id: typeof row.id === "string" && row.id ? row.id : `category-${index}`,
        pricing_type:
          typeof row.pricing_type === "string" && row.pricing_type.trim()
            ? row.pricing_type.trim()
            : null,
        pricing_category_id:
          typeof row.pricing_category_id === "string" && row.pricing_category_id.trim()
            ? row.pricing_category_id.trim()
            : null,
        pricing_category_name:
          typeof row.pricing_category_name === "string" && row.pricing_category_name.trim()
            ? row.pricing_category_name.trim()
            : null,
        variant_name: typeof row.variant_name === "string" ? row.variant_name.trim() : "",
        display_name: typeof row.display_name === "string" ? row.display_name.trim() : "",
        supplier_price_list_code: typeof row.supplier_price_list_code === "string" ? row.supplier_price_list_code.trim() : "",
        dimension: typeof row.dimension === "string" ? row.dimension.trim() : "",
        currency: normalizeCurrency(typeof row.currency === "string" ? row.currency : defaultCurrency),
        prices: Object.fromEntries(normalizedPrices.entries()),
        unavailable_categories: Array.from(new Set((Array.isArray(row.unavailable_categories) ? row.unavailable_categories : [])
          .filter((category): category is string => typeof category === "string" && normalizedPrices.has(category)))),
        specification: typeof row.specification === "string" ? row.specification.trim() : "",
        modular_default_dimension:
          typeof row.modular_default_dimension === "string" && row.modular_default_dimension.trim()
            ? row.modular_default_dimension.trim()
            : null,
        modular_default_specification:
          typeof row.modular_default_specification === "string" && row.modular_default_specification.trim()
            ? row.modular_default_specification.trim()
            : null,
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
        is_active: row.is_active !== false,
      };
    };

    const normalizeDirectModularRow = (row: Record<string, unknown>, index: number) => {
      const role = typeof row.modular_role === "string" && (MODULAR_ROLES as readonly string[]).includes(row.modular_role)
        ? row.modular_role as ModularRole
        : undefined;
      const importantRequirements = Array.isArray(row.importantRequirements)
        ? Array.from(new Set(row.importantRequirements.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)))
        : [];
      return {
        id: typeof row.id === "string" && row.id ? row.id : `modular-direct-${index}`,
        pricing_type: MODULAR_ITEM_PRICING_TYPE,
        variant_name: typeof row.variant_name === "string" ? row.variant_name.trim() : "",
        display_name: typeof row.display_name === "string" ? row.display_name.trim() : "",
        supplier_price_list_code: typeof row.supplier_price_list_code === "string" ? row.supplier_price_list_code.trim() : "",
        dimension: typeof row.dimension === "string" ? row.dimension.trim() : "",
        currency: normalizeCurrency(typeof row.currency === "string" ? row.currency : defaultCurrency),
        price: parseNullablePricingNumber(row.price),
        prices: {} as Record<string, number | null>,
        unavailable_categories: [] as string[],
        specification: typeof row.specification === "string" ? row.specification.trim() : "",
        ...(importantRequirements.length ? { importantRequirements } : {}),
        ...(role ? { modular_role: role } : {}),
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
        is_active: row.is_active !== false,
      };
    };

    const normalizeModularComposition = (value: Record<string, unknown>) => {
      const min = Number(value.min_starters);
      const maxRaw = value.max_starters;
      const max = maxRaw === null || maxRaw === undefined ? null : Number(maxRaw);
      return {
        min_starters: Number.isInteger(min) && min >= 0 ? min : 0,
        max_starters: max !== null && Number.isInteger(max) && max >= 1 ? max : null,
      };
    };

    const standardGroups = groupedStandardCategoryPricingRows(
      (Array.isArray(parsed) ? parsed : []) as Array<Record<string, unknown>>,
    ).map((group, groupIndex) => ({
      id: typeof group.id === "string" && group.id ? group.id : `category-group-${groupIndex}`,
      group_name: typeof group.group_name === "string" && group.group_name.trim()
        ? group.group_name.trim()
        : "Finish Category Pricing",
      sort_order: Number.isFinite(Number(group.sort_order)) ? Number(group.sort_order) : groupIndex,
      is_active: group.is_active !== false,
      price_categories: explicitPricingCategoryLabels(group.price_categories),
      items: (group.items ?? [])
        .map((item, itemIndex) => normalizeCategoryRow(item as Record<string, unknown>, itemIndex, explicitPricingCategoryLabels(group.price_categories)))
        .filter((row) =>
          row.variant_name || row.display_name || row.supplier_price_list_code || row.dimension || Object.values(row.prices).some((price) => price !== null) || row.specification,
        ),
    })).filter((group) => group.items.length || group.group_name);

    const modularGroups = (Array.isArray(parsedModular) ? parsedModular : [])
      .filter((row) => row?.pricing_type === MODULAR_GROUP_PRICING_TYPE)
      .map((group, groupIndex) => {
        const isDirect = group.modular_pricing_mode === "direct";
        const priceCategories = isDirect ? [] : explicitPricingCategoryLabels(group.price_categories);
        const composition = isDirect && group.modular_composition && typeof group.modular_composition === "object" && !Array.isArray(group.modular_composition)
          ? normalizeModularComposition(group.modular_composition as Record<string, unknown>)
          : null;
        const selectionFamily = typeof group.modular_selection_family === "string" && group.modular_selection_family.trim()
          ? group.modular_selection_family.trim()
          : null;
        const items = isDirect
          ? (Array.isArray(group.items) ? group.items : [])
              .map((item, itemIndex) => normalizeDirectModularRow(item as Record<string, unknown>, itemIndex))
              .filter((row) => row.variant_name || row.display_name || row.supplier_price_list_code || row.dimension || row.price !== null || row.specification)
          : (Array.isArray(group.items) ? group.items : [])
              .map((item, itemIndex) => normalizeCategoryRow(item as Record<string, unknown>, itemIndex, priceCategories))
              .map((item) => ({ ...item, pricing_type: MODULAR_ITEM_PRICING_TYPE }))
              .filter((row) => row.variant_name || row.display_name || row.supplier_price_list_code || row.dimension || Object.values(row.prices).some((price) => price !== null) || row.specification);
        return {
          id: typeof group.id === "string" && group.id ? group.id : `modular-group-${groupIndex}`,
          pricing_type: MODULAR_GROUP_PRICING_TYPE,
          group_name: typeof group.group_name === "string" && group.group_name.trim()
            ? group.group_name.trim()
            : "Modular Items",
          sort_order: Number.isFinite(Number(group.sort_order)) ? Number(group.sort_order) : groupIndex,
          is_active: group.is_active !== false,
          price_categories: priceCategories,
          ...(isDirect ? { modular_pricing_mode: "direct" as const, ...(composition ? { modular_composition: composition } : {}) } : {}),
          ...(selectionFamily ? { modular_selection_family: selectionFamily } : {}),
          items,
        };
      })
      .filter((group) => (group.items?.length ?? 0) > 0 || group.group_name);

    const rows = sourceRows
      .map((row, index) => {
        return normalizeCategoryRow(row, index);
      })
      .filter((row) => row.pricing_type === MODULAR_ITEM_PRICING_TYPE || row.pricing_type === MODULAR_META_PRICING_TYPE)
      .filter((row) =>
        row.pricing_type === MODULAR_ITEM_PRICING_TYPE
          ? row.variant_name || row.display_name || row.supplier_price_list_code || row.dimension || Object.values(row.prices).some((price) => price !== null) || row.specification
          : row.variant_name || row.display_name || row.supplier_price_list_code || row.dimension || Object.values(row.prices).some((price) => price !== null) || row.specification,
      );

    const modularDefaultSpecification =
      typeof modularDefaults.modular_default_specification === "string" && modularDefaults.modular_default_specification.trim()
        ? modularDefaults.modular_default_specification.trim()
        : null;
    const modularDefaultDimension =
      typeof modularDefaults.modular_default_dimension === "string" && modularDefaults.modular_default_dimension.trim()
        ? modularDefaults.modular_default_dimension.trim()
        : null;

    if (modularDefaultSpecification || modularDefaultDimension) {
      rows.unshift({
        id: "modular-meta",
        pricing_type: MODULAR_META_PRICING_TYPE,
        pricing_category_id: null,
        pricing_category_name: null,
        variant_name: "",
        display_name: "",
        supplier_price_list_code: "",
        dimension: "",
        currency: defaultCurrency,
        prices: Object.fromEntries([["Cat A", null], ["Cat B", null], ["Cat C", null], ["Cat D", null]]),
        unavailable_categories: [],
        specification: "",
        modular_default_dimension: modularDefaultDimension,
        modular_default_specification: modularDefaultSpecification,
        sort_order: -1,
        is_active: true,
      });
    }

    return [...standardGroups, ...modularGroups, ...rows];
  } catch {
    return [];
  }
}
