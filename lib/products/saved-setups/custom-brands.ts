/**
 * Brand helpers for My Collection custom items. PURE: no React, no database.
 * There is no brand table: the brand list is derived from the owner's own saved_custom_items.brand_name values.
 * Brands that differ only by case or extra spaces are the SAME brand and use one spelling.
 */
import { CUSTOM_ITEM_BRAND_MAX } from "./custom-item";

export const CUSTOM_BRAND_PAGE_SIZE = 12;
export const CUSTOM_BRAND_RECENT_LIMIT = 6;

export type BrandCount = { brandName: string; count: number };

/** Trim and collapse inner spaces. The spelling the user sees. */
export function cleanBrandName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Comparison key: case-insensitive, extra spaces ignored. */
export function normaliseBrandKey(value: unknown): string {
  return cleanBrandName(value).toLowerCase();
}

/**
 * Distinct brands with item counts, A-Z. Case/space variants merge; the shown spelling is the most used one
 * (ties: the first in A-Z order), so the list is stable.
 */
export function distinctBrands(items: ReadonlyArray<{ brandName: string }>): BrandCount[] {
  const groups = new Map<string, Map<string, number>>();
  for (const item of items) {
    const key = normaliseBrandKey(item.brandName);
    if (!key) continue;
    const spelling = cleanBrandName(item.brandName);
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(spelling, (spellings.get(spelling) ?? 0) + 1);
    groups.set(key, spellings);
  }
  const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }) || (a < b ? -1 : a > b ? 1 : 0); // code-point tie-break: deterministic ('Beta' before 'beta')
  return Array.from(groups.values())
    .map((spellings) => {
      const ranked = Array.from(spellings).sort((a, b) => b[1] - a[1] || compare(a[0], b[0]));
      return { brandName: ranked[0][0], count: Array.from(spellings.values()).reduce((sum, n) => sum + n, 0) };
    })
    .sort((a, b) => compare(a.brandName, b.brandName));
}

export type BrandResolution = { ok: true; name: string; isNew: boolean } | { ok: false; error: string };

/** An input matching an existing brand (ignoring case and extra spaces) uses the EXISTING spelling. */
export function resolveBrandInput(input: unknown, existing: ReadonlyArray<BrandCount | string>): BrandResolution {
  const name = cleanBrandName(input);
  if (!name) return { ok: false, error: "Enter a brand." };
  if (name.length > CUSTOM_ITEM_BRAND_MAX) return { ok: false, error: `The brand can have at most ${CUSTOM_ITEM_BRAND_MAX} characters.` };
  const key = normaliseBrandKey(name);
  for (const entry of existing) {
    const spelling = typeof entry === "string" ? entry : entry.brandName;
    if (normaliseBrandKey(spelling) === key) return { ok: true, name: cleanBrandName(spelling), isNew: false };
  }
  return { ok: true, name, isNew: true };
}

/** Items of one brand (case/space-insensitive). null or empty brand = all items. */
export function filterByBrand<T extends { brandName: string }>(items: readonly T[], brandName: string | null | undefined): T[] {
  const key = normaliseBrandKey(brandName);
  if (!key) return [...items];
  return items.filter((item) => normaliseBrandKey(item.brandName) === key);
}

/** Suggestions for the combobox: existing brands whose key contains the typed text (all when empty). */
export function suggestBrands(existing: readonly BrandCount[], typed: string): BrandCount[] {
  const key = normaliseBrandKey(typed);
  return key ? existing.filter((brand) => normaliseBrandKey(brand.brandName).includes(key)) : [...existing];
}

/** True when the typed text names no existing brand yet (shows the "+ New brand" row). */
export function isNewBrandInput(existing: readonly BrandCount[], typed: string): boolean {
  const result = resolveBrandInput(typed, existing);
  return result.ok && result.isNew;
}
