/**
 * Product Gallery page helpers. Pure: no React, no server code, no price. The page keeps its filters in the URL query string;
 * parse and build live here so they can be tested. Dates use the Asia/Dubai format of My Collection (formatSavedDate).
 */
import { formatSavedDate } from "../saved-setups/collection-view";
import { cleanGalleryTag, gallerySortMode, isGalleryId, validateGalleryDisplayName, validateGalleryTags, type GalleryListItem, type GallerySortMode, type GallerySubCategoryEntry } from "./gallery";

export const GALLERY_SEARCH_DEBOUNCE_MS = 300;
export const GALLERY_SORT_LABELS: Record<GallerySortMode, string> = { popular: "Most quoted", newest: "Newest", name: "Name" };
/** Merge candidates are read page by page (30 each); this caps how many pages one merge dialog will read. */
export const GALLERY_MERGE_MAX_PAGES = 10;

export type GalleryUrlState = {
  query: string;
  brandId: string;
  categoryId: string;
  subCategoryId: string;
  currency: string;
  tag: string;
  sort: GallerySortMode;
};

export const EMPTY_GALLERY_STATE: GalleryUrlState = { query: "", brandId: "", categoryId: "", subCategoryId: "", currency: "", tag: "", sort: "popular" };

type ParamValue = string | string[] | null | undefined;
const first = (value: ParamValue): string => (Array.isArray(value) ? value[0] ?? "" : value ?? "");

/** URL -> state. Anything unusable (a bad id, a bad currency, an unknown sort) is dropped, never trusted. */
export function parseGalleryQuery(read: (key: string) => ParamValue): GalleryUrlState {
  const id = (key: string) => (isGalleryId(first(read(key))) ? first(read(key)) : "");
  const currency = first(read("currency")).trim().toUpperCase();
  const tag = cleanGalleryTag(first(read("tag")));
  const categoryId = id("category");
  return {
    query: first(read("q")).slice(0, 100),
    brandId: id("brand"),
    categoryId,
    subCategoryId: id("sub"),
    currency: /^[A-Z]{1,8}$/.test(currency) ? currency : "",
    tag: tag ?? "",
    sort: gallerySortMode(first(read("sort"))),
  };
}

/** state -> query string without the leading "?". Defaults are left out so a plain gallery URL stays clean. */
export function buildGalleryQuery(state: GalleryUrlState): string {
  const params = new URLSearchParams();
  if (state.query.trim()) params.set("q", state.query.trim());
  if (state.brandId) params.set("brand", state.brandId);
  if (state.categoryId) params.set("category", state.categoryId);
  if (state.subCategoryId) params.set("sub", state.subCategoryId);
  if (state.currency) params.set("currency", state.currency);
  if (state.tag) params.set("tag", state.tag);
  if (state.sort !== "popular") params.set("sort", state.sort);
  return params.toString();
}

/** "Clear filters" shows when any FILTER is set (sort is a view, not a filter). Edit mode is not in the URL at all. */
export function hasActiveGalleryFilters(state: GalleryUrlState): boolean {
  return activeGalleryFilterCount(state) > 0;
}

export function activeGalleryFilterCount(state: GalleryUrlState): number {
  return [state.query.trim(), state.brandId, state.categoryId, state.subCategoryId, state.currency, state.tag].filter(Boolean).length;
}

export function clearedGalleryFilters(state: GalleryUrlState): GalleryUrlState {
  return { ...EMPTY_GALLERY_STATE, sort: state.sort };
}

/**
 * Sub-category select label. The Sub-category filter is independent of the Category filter and lists them all; the parent main
 * category is added only where two sub-categories share a name, so they can be told apart ("Desk / Executive").
 */
export function subCategoryLabel(entry: GallerySubCategoryEntry, all: GallerySubCategoryEntry[]): string {
  const duplicated = all.filter((other) => other.name.toLowerCase() === entry.name.toLowerCase()).length > 1;
  const name = duplicated && entry.parentCategoryName ? `${entry.parentCategoryName} / ${entry.name}` : entry.name;
  return filterOptionLabel(name, entry.count);
}

/** "LAS MOBILI (12)" */
export function filterOptionLabel(name: string, count: number): string {
  return `${name} (${count})`;
}

/** "Quoted once" / "Quoted 3 times" */
export function quotedText(count: number): string {
  const value = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return value === 1 ? "Quoted once" : `Quoted ${value} times`;
}

/** "Last quoted 12 Oct 2026" (Asia/Dubai); empty when the date is missing. */
export function lastQuotedText(value: string | null | undefined): string {
  const date = formatSavedDate(value);
  return date ? `Last quoted ${date}` : "";
}

export function showingText(shown: number, total: number): string {
  return `Showing ${shown} of ${total}`;
}

/** "Open full detail" in the details popup: the canonical Product Management URL of the product. */
export function fullDetailHref(templateId: string): string {
  return `/products/manage?template=${encodeURIComponent(templateId)}`;
}

/** Merge candidates: the OTHER items of the SAME product (template), each once. Never an item of a different product. */
export function mergeCandidates(items: Array<Pick<GalleryListItem, "id" | "templateId">>, source: Pick<GalleryListItem, "id" | "templateId">): Array<Pick<GalleryListItem, "id" | "templateId">> {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.id === source.id || item.templateId !== source.templateId || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/** "chair, Office,, chair" -> ["chair","office"] (comma separated, trimmed, lower-cased, no duplicates). */
export function parseTagInput(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(",")) {
    const tag = part.trim().toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

export function formatTagInput(tags: string[]): string {
  return tags.join(", ");
}

/** The same limits as the server (name 1-120 or empty; max 20 tags of 1-30 characters), so the dialog can say what is wrong. */
export function editFormProblem(displayName: string, tagText: string): string | null {
  if (!validateGalleryDisplayName(displayName).ok) return "The name must be 1 to 120 characters, or empty to clear it.";
  if (!validateGalleryTags(parseTagInput(tagText)).ok) return "Use at most 20 tags, each 1 to 30 characters.";
  return null;
}
