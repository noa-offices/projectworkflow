// Pure rules for the Brands page: reading the URL, filtering the loaded list, and writing the URL back. No React, no database.
export type BrandStatusFilter = "all" | "active" | "archived";
export type BrandMethodFilter = "all" | "codes" | "manual";
export type BrandFilters = { q: string; status: BrandStatusFilter; method: BrandMethodFilter };
export type BrandListRow = { id: string; name: string; code: string | null; origin: string | null; isActive: boolean; method: "codes" | "manual" };

export const defaultBrandFilters: BrandFilters = { q: "", status: "all", method: "all" };

/** Reads ?q=, ?status= and ?method=. Unknown values fall back to All. The old values "inactive" and "archive" mean Archived. */
export function parseBrandFilters(get: (key: string) => string | null | undefined): BrandFilters {
  const status = (get("status") ?? "").toLowerCase(), method = (get("method") ?? "").toLowerCase();
  return {
    q: (get("q") ?? "").trim().slice(0, 100),
    status: status === "active" ? "active" : status === "archived" || status === "archive" || status === "inactive" ? "archived" : "all",
    method: method === "codes" ? "codes" : method === "manual" ? "manual" : "all",
  };
}

/** Name, code and origin, ignoring case; status and method apply at once. */
export function filterBrands<T extends BrandListRow>(rows: T[], filters: BrandFilters): T[] {
  const needle = filters.q.trim().toLowerCase();
  return rows.filter((row) =>
    (filters.status === "all" || (filters.status === "active") === row.isActive)
    && (filters.method === "all" || filters.method === row.method)
    && (!needle || [row.name, row.code ?? "", row.origin ?? ""].some((value) => value.toLowerCase().includes(needle))));
}

/** The query string for the address bar: other parameters (brand, category, ...) are kept; default filters are left out. */
export function brandFilterQuery(filters: BrandFilters, current: string | URLSearchParams = ""): string {
  const next = new URLSearchParams(typeof current === "string" ? current : current.toString());
  const q = filters.q.trim();
  if (q) next.set("q", q); else next.delete("q");
  if (filters.status !== "all") next.set("status", filters.status); else next.delete("status");
  if (filters.method !== "all") next.set("method", filters.method); else next.delete("method");
  const text = next.toString();
  return text ? `?${text}` : "";
}

export const brandCountText = (shown: number, total: number) => `${shown} of ${total} brands`;
export const noBrandsMatchText = (q: string) => q.trim() ? `No brands match "${q.trim()}".` : "No brands match the filters.";
