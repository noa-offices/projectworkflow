/**
 * Display helpers for My Collection (page and picker). PURE: no React, no database, no prices.
 * Search is client side (name, product, brand); sort is Recently used (default), Newest, or Name A-Z.
 */

export type CollectionSortMode = "recent" | "newest" | "name";
export const COLLECTION_SORT_OPTIONS: ReadonlyArray<{ value: CollectionSortMode; label: string }> = [
  { value: "recent", label: "Recently used" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name A-Z" },
];

export type CollectionDisplayItem = {
  id: string;
  brandName: string;
  productName: string;
  setupName: string;
  createdAt?: string | null;
  lastUsedAt?: string | null;
  useCount?: number | null;
  /** Optional extra search text (custom items: the item code). */
  code?: string | null;
};

function time(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function byName(a: CollectionDisplayItem, b: CollectionDisplayItem) {
  return a.setupName.localeCompare(b.setupName, undefined, { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id);
}

/** Case-insensitive match on setup name, product name or brand. An empty query keeps everything. */
export function filterSetups<T extends CollectionDisplayItem>(items: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) => [item.setupName, item.productName, item.brandName, item.code ?? ""].some((value) => value.toLowerCase().includes(needle)));
}

/**
 * recent: last_used_at (newest first), never-used setups after used ones, ordered by created_at;
 * newest: created_at descending; name: A-Z. Ties fall back to the name, so the order is stable.
 */
export function sortSetups<T extends CollectionDisplayItem>(items: readonly T[], mode: CollectionSortMode): T[] {
  const list = [...items];
  if (mode === "name") return list.sort(byName);
  if (mode === "newest") return list.sort((a, b) => time(b.createdAt) - time(a.createdAt) || byName(a, b));
  return list.sort((a, b) => time(b.lastUsedAt) - time(a.lastUsedAt) || time(b.createdAt) - time(a.createdAt) || byName(a, b));
}

/** Setups that have actually been used, most recently used first (empty when no use data exists). */
export function recentlyUsed<T extends CollectionDisplayItem>(items: readonly T[], limit = 4): T[] {
  return items
    .filter((item) => time(item.lastUsedAt) > 0)
    .sort((a, b) => time(b.lastUsedAt) - time(a.lastUsedAt) || byName(a, b))
    .slice(0, limit);
}

export type BrandGroup<T> = { brandName: string; count: number; products: Array<{ productName: string; setups: T[] }> };

/** Brand > Product > setups. Brands and products are ordered A-Z; setups keep the order they were given. */
export function groupByBrandProduct<T extends CollectionDisplayItem>(items: readonly T[]): BrandGroup<T>[] {
  const brands = new Map<string, Map<string, T[]>>();
  for (const item of items) {
    const products = brands.get(item.brandName) ?? new Map<string, T[]>();
    products.set(item.productName, [...(products.get(item.productName) ?? []), item]);
    brands.set(item.brandName, products);
  }
  const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  return Array.from(brands, ([brandName, products]) => ({
    brandName,
    count: Array.from(products.values()).reduce((sum, setups) => sum + setups.length, 0),
    products: Array.from(products, ([productName, setups]) => ({ productName, setups })).sort((a, b) => compare(a.productName, b.productName)),
  })).sort((a, b) => compare(a.brandName, b.brandName));
}

export type FlatBrandGroup<T> = { brandName: string; count: number; items: T[] };

/** Brand > items (custom items). Brands A-Z; items keep the order they were given, so the chosen sort is respected. */
export function groupByBrand<T extends CollectionDisplayItem>(items: readonly T[]): FlatBrandGroup<T>[] {
  const brands = new Map<string, T[]>();
  for (const item of items) brands.set(item.brandName, [...(brands.get(item.brandName) ?? []), item]);
  return Array.from(brands, ([brandName, list]) => ({ brandName, count: list.length, items: list })).sort((a, b) =>
    a.brandName.localeCompare(b.brandName, undefined, { sensitivity: "base", numeric: true }),
  );
}

// ── Configured products: brand / product filters (popup; PR "My Collection popup manager") ─────────────────────────
export const CONFIGURED_PAGE_SIZE = 12;
export const CONFIGURED_RECENT_LIMIT = 6;

export type CountEntry = { name: string; count: number };
export type ConfiguredFilter = { brand?: string | null; product?: string | null; query?: string | null };

const compareNames = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);

/** "All brands" column: each brand with its setup count, A-Z. */
export function brandsWithCounts<T extends { brandName: string }>(items: readonly T[]): CountEntry[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.brandName, (counts.get(item.brandName) ?? 0) + 1);
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => compareNames(a.name, b.name));
}

/** Products of ONE brand with their setup counts, A-Z (the second list under a selected brand). */
export function productsForBrand<T extends { brandName: string; productName: string }>(items: readonly T[], brand: string | null | undefined): CountEntry[] {
  if (!brand) return [];
  const counts = new Map<string, number>();
  for (const item of items) if (item.brandName === brand) counts.set(item.productName, (counts.get(item.productName) ?? 0) + 1);
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => compareNames(a.name, b.name));
}

/** Brand, then product (within that brand), then the case-insensitive search (name, product, brand, code). Order is kept. */
export function filterConfigured<T extends CollectionDisplayItem>(items: readonly T[], filter: ConfiguredFilter): T[] {
  let list: readonly T[] = items;
  if (filter.brand) list = list.filter((item) => item.brandName === filter.brand);
  if (filter.product) list = list.filter((item) => item.productName === filter.product);
  return filterSetups(list, filter.query ?? "");
}

/** True when any filter narrows the list ("Clear filters" is shown). */
export function hasActiveFilters(filter: ConfiguredFilter): boolean {
  return Boolean(filter.brand || filter.product || (filter.query ?? "").trim());
}

/** First `limit` items and how many are still hidden ("Show more (N more)"). */
export function showMoreSlice<T>(items: readonly T[], limit: number): { visible: T[]; remaining: number } {
  const visible = items.slice(0, Math.max(0, limit));
  return { visible, remaining: items.length - visible.length };
}

export function itemCountLabel(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

export function setupCountLabel(count: number): string {
  return `${count} ${count === 1 ? "setup" : "setups"}`;
}

/** "17 Nov 2026" (UTC, so the same text on server and browser). Empty when the date is missing. */
export function formatSavedDate(value: string | null | undefined): string {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "Saved 17 Nov 2026 · Used 3 times" (or "Not used yet"). */
export function savedLine({ createdAt, useCount }: Pick<CollectionDisplayItem, "createdAt" | "useCount">): string {
  const saved = formatSavedDate(createdAt);
  const used = Number(useCount ?? 0);
  const usedText = used > 0 ? `Used ${used} ${used === 1 ? "time" : "times"}` : "Not used yet";
  return [saved ? `Saved ${saved}` : "", usedText].filter(Boolean).join(" · ");
}

/** Left sidebar: My Collection is active on its own page only (it never lights up Product Library). */
export function isMyCollectionActive(pathname: string): boolean {
  return pathname === "/products/my-collection" || pathname.startsWith("/products/my-collection/");
}
