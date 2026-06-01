import {
  isModularItemPricingRow,
  isModularMetaPricingRow,
} from "@/lib/products/modular-pricing";

const defaultCategoryColumns = ["Cat A", "Cat B", "Cat C", "Cat D"];

export type CategoryPricingGroupLike<TItem> = {
  id?: string;
  group_name?: string;
  items?: TItem[];
  price_categories?: string[];
  is_active?: boolean;
  sort_order?: number;
};

type StandardCategoryPricingLike = {
  id?: string;
  pricing_type?: string | null;
  prices?: Record<string, unknown>;
  is_active?: boolean;
  sort_order?: number;
  group_name?: string;
  group_id?: string;
};

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function normalizeCategoryPriceLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const compact = trimmed.replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const match = compact.match(/^cat\s*([a-z0-9]+)$/i);
  if (match) {
    return `Cat ${match[1].toUpperCase()}`;
  }

  return compact
    .split(" ")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function isCategoryPricingGroup<TItem>(
  row: TItem | CategoryPricingGroupLike<TItem> | null | undefined,
): row is CategoryPricingGroupLike<TItem> {
  if (!row || typeof row !== "object") return false;
  return Array.isArray((row as CategoryPricingGroupLike<TItem>).items)
    || typeof (row as CategoryPricingGroupLike<TItem>).group_name === "string"
    || Array.isArray((row as CategoryPricingGroupLike<TItem>).price_categories);
}

function isStandardCategoryRow<TItem extends StandardCategoryPricingLike>(
  row: TItem | CategoryPricingGroupLike<TItem>,
): row is TItem {
  return !isCategoryPricingGroup(row) && !isModularItemPricingRow(row) && !isModularMetaPricingRow(row);
}

export function groupedStandardCategoryPricingRows<TItem extends StandardCategoryPricingLike>(
  rows?: Array<TItem | CategoryPricingGroupLike<TItem>> | null,
) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const groups = sourceRows
    .filter(isCategoryPricingGroup<TItem>)
    .map((group, index) => {
      const items = (Array.isArray(group.items) ? group.items : [])
        .filter((item): item is TItem => Boolean(item) && typeof item === "object")
        .filter((item) => !isModularItemPricingRow(item) && !isModularMetaPricingRow(item))
        .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order))
        .map((item) => ({
          ...item,
          group_id: group.id ?? `finish-group-${index}`,
          group_name: group.group_name?.trim() || "Finish Category Pricing",
        }));

      const priceCategories = Array.from(new Set([
        ...defaultCategoryColumns,
        ...((group.price_categories ?? []).map(normalizeCategoryPriceLabel).filter(Boolean)),
        ...items.flatMap((item) => Object.keys(item.prices ?? {}).map(normalizeCategoryPriceLabel).filter(Boolean)),
      ]));

      return {
        id: group.id ?? `finish-group-${index}`,
        group_name: group.group_name?.trim() || "Finish Category Pricing",
        is_active: group.is_active !== false,
        sort_order: numberValue(group.sort_order ?? index),
        price_categories: priceCategories,
        items,
      };
    })
    .filter((group) => group.group_name || group.items.length);

  const flatRows = sourceRows
    .filter(isStandardCategoryRow)
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order))
    .map((item) => ({
      ...item,
      group_id: "finish-category-pricing",
      group_name: "Finish Category Pricing",
    }));

  if (flatRows.length) {
    groups.push({
      id: "finish-category-pricing",
      group_name: "Finish Category Pricing",
      is_active: true,
      sort_order: groups.length,
      price_categories: Array.from(new Set([
        ...defaultCategoryColumns,
        ...flatRows.flatMap((item) => Object.keys(item.prices ?? {}).map(normalizeCategoryPriceLabel).filter(Boolean)),
      ])),
      items: flatRows,
    });
  }

  return groups.sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
}

export function flattenStandardCategoryPricingRows<TItem extends StandardCategoryPricingLike>(
  rows?: Array<TItem | CategoryPricingGroupLike<TItem>> | null,
) {
  return groupedStandardCategoryPricingRows(rows)
    .flatMap((group) => group.items)
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
}

export function standardCategoryPriceColumns<TItem extends StandardCategoryPricingLike>(
  rows?: Array<TItem | CategoryPricingGroupLike<TItem>> | null,
) {
  const columns = [...defaultCategoryColumns];

  groupedStandardCategoryPricingRows(rows).forEach((group) => {
    (group.price_categories ?? []).forEach((category) => {
      const normalized = normalizeCategoryPriceLabel(category);
      if (normalized && !columns.includes(normalized)) {
        columns.push(normalized);
      }
    });

    group.items.forEach((item) => {
      Object.keys(item.prices ?? {}).forEach((category) => {
        const normalized = normalizeCategoryPriceLabel(category);
        if (normalized && !columns.includes(normalized)) {
          columns.push(normalized);
        }
      });
    });
  });

  return columns;
}

export function countStandardCategoryPricingRows<TItem extends StandardCategoryPricingLike>(
  rows?: Array<TItem | CategoryPricingGroupLike<TItem>> | null,
) {
  return groupedStandardCategoryPricingRows(rows).reduce((count, group) => count + group.items.length, 0);
}
