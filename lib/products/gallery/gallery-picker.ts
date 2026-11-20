import type { GalleryListItem, GallerySortMode } from "./gallery";

/** Pure helpers of the quotation builder's Gallery picker. No price, no recipe, no storage. */
export type GalleryPickerFilters = { query: string; brandId: string; categoryId: string; subCategoryId: string; sort: GallerySortMode };
export const EMPTY_PICKER_FILTERS: GalleryPickerFilters = { query: "", brandId: "", categoryId: "", subCategoryId: "", sort: "popular" };

/** The list request: the same action and paging as the gallery page. Hidden items are excluded by the action (includeHidden is never sent). */
export function pickerListInput(filters: GalleryPickerFilters, page: number) {
  return {
    query: filters.query,
    brandId: filters.brandId || null,
    categoryId: filters.categoryId || null,
    subCategoryId: filters.subCategoryId || null,
    sort: filters.sort,
    page,
  };
}

export const hasPickerFilters = (filters: GalleryPickerFilters) => Boolean(filters.query || filters.brandId || filters.categoryId || filters.subCategoryId);

/** An item whose product is gone or retired cannot be picked. "Update available" items stay pickable. */
export const isPickable = (item: Pick<GalleryListItem, "available">) => item.available;

/** What the parent receives: the id and the name, nothing else. */
export const pickPayload = (item: Pick<GalleryListItem, "id" | "displayName">) => ({ id: item.id, name: item.displayName });

/** Load more: append the next page without repeating an item already shown. */
export function appendPickerPage(current: readonly GalleryListItem[], next: readonly GalleryListItem[]): GalleryListItem[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !seen.has(item.id))];
}

export const pickerKindLine = (item: Pick<GalleryListItem, "brandName" | "categoryName">) => [item.brandName, item.categoryName].filter(Boolean).join(" · ");
