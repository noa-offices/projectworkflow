// Pure rules for the Brand Material Library overview: what each filter matches, the brand rows, the chips, the count and empty texts,
// and the address bar query. No React, no database. The search and filter meaning is the same as before the redesign.
export type MaterialLibraryFilters = { brand: string; group: string; level: "brands" | "groups"; q: string; sort: string; status: string; view: string };
export type LibraryGroup = { activeCount: number; brandId: string; id: string; isActive: boolean; name: string; needsReview: boolean; searchText: string; thumbs: Array<{ code: string; url: string | null }>; updatedAt: string };
export type LibraryBrand = { code: string | null; id: string; isActive: boolean; name: string };
export type LibraryBrandRow<G extends LibraryGroup = LibraryGroup, B extends LibraryBrand = LibraryBrand> = { brand: B; groups: G[]; materials: number; thumbs: G["thumbs"] };

export const defaultMaterialLibraryFilters: MaterialLibraryFilters = { brand: "", group: "", level: "brands", q: "", sort: "updated", status: "", view: "grid" };
export const materialLibraryUrlKeys: Array<[keyof MaterialLibraryFilters, string]> = [["q", "q"], ["brand", "libBrand"], ["group", "libGroup"], ["level", "libLevel"], ["status", "libStatus"], ["sort", "libSort"], ["view", "libView"]];

/** Every word typed must be found in the group's search text (group, description, brand, material names and codes). */
export function filterMaterialGroups<G extends LibraryGroup>(groups: G[], filters: MaterialLibraryFilters): G[] {
  const words = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matching = groups.filter((group) =>
    (!filters.brand || group.brandId === filters.brand) &&
    (!filters.group || group.name === filters.group) &&
    (filters.status === "" ||
      (filters.status === "active" && group.isActive) ||
      (filters.status === "inactive" && !group.isActive) ||
      (filters.status === "needs_review" && group.needsReview)) &&
    words.every((word) => group.searchText.includes(word)));
  return [...matching].sort((left, right) =>
    filters.sort === "name" ? left.name.localeCompare(right.name)
      : filters.sort === "materials" ? right.activeCount - left.activeCount || left.name.localeCompare(right.name)
        : right.updatedAt.localeCompare(left.updatedAt));
}

/** Brand cards show while nothing narrows the list; searching, a Group/Status filter, "All groups" or an opened brand show group cards. */
export const isSearching = (filters: MaterialLibraryFilters) => Boolean(filters.q.trim() || filters.group || filters.status);
export const showsBrandLevel = (filters: MaterialLibraryFilters) => !isSearching(filters) && !filters.brand && filters.level !== "groups";

/** One row per Brand: its groups, active material total, and up to 5 pictures (up to 2 per group in order so the groups are mixed). */
export function buildBrandRows<G extends LibraryGroup, B extends LibraryBrand>(brands: B[], groups: G[]): Array<LibraryBrandRow<G, B>> {
  return brands.map((brand) => {
    const own = groups.filter((group) => group.brandId === brand.id);
    const thumbs: G["thumbs"] = [];
    for (let round = 0; round < 2; round += 1) for (const group of own) if (group.thumbs[round] && thumbs.length < 5) thumbs.push(group.thumbs[round]);
    return { brand, groups: own, materials: own.reduce((total, group) => total + group.activeCount, 0), thumbs };
  }).sort((left, right) => left.brand.name.localeCompare(right.brand.name));
}

/** The chip numbers follow the opened Brand, if any. Only "Needs review" is also a filter. */
export function materialLibraryChips(groups: LibraryGroup[], brandId: string) {
  const scoped = brandId ? groups.filter((group) => group.brandId === brandId) : groups;
  return { groups: scoped.length, active: scoped.filter((group) => group.isActive).length, materials: scoped.reduce((total, group) => total + group.activeCount, 0), needsReview: scoped.filter((group) => group.needsReview).length, scoped: scoped.length };
}

/** Clicking Needs review filters by it; clicking it again clears it. */
export const toggleNeedsReview = (filters: MaterialLibraryFilters): MaterialLibraryFilters => ({ ...filters, status: filters.status === "needs_review" ? "" : "needs_review" });

/** The query string kept in the address bar and used as return_to. Defaults are left out. */
export function materialLibraryQuery(filters: MaterialLibraryFilters, current: string | URLSearchParams = ""): string {
  const next = new URLSearchParams(typeof current === "string" ? current : current.toString());
  for (const [key, param] of materialLibraryUrlKeys) {
    const value = key === "q" ? filters.q.trim() : filters[key];
    if (value && value !== defaultMaterialLibraryFilters[key]) next.set(param, value); else next.delete(param);
  }
  const text = next.toString();
  return text ? `?${text}` : "";
}

export const materialLibraryCountText = (shown: number, total: number, unit: "brands" | "groups") => `${shown} of ${total} ${unit}`;
export const noMaterialResultsText = (q: string) => q.trim() ? `No results for "${q.trim()}".` : "No material groups match these filters.";
