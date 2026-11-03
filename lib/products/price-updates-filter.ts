// Pure rules for the Price Updates page: reading the URL, the status chips, and filtering the loaded Brand cards. No React, no database.
export type PriceUpdatesMethod = "all" | "codes" | "manual";
export type PriceUpdatesFilters = { q: string; /** A Brand state such as "needs_attention", or "" for all. */ status: string; method: PriceUpdatesMethod };
export type PriceUpdatesRow = { brandId: string; name: string; state: string; method: "codes" | "manual"; /** The supplier facts of this Brand could not be read. */ failed?: boolean };

/** The four chips, in order. They use the same Brand states as the old summary tiles. */
export const priceUpdatesChips: Array<{ state: string; label: string }> = [
  { state: "current", label: "Current" }, { state: "update_available", label: "Updates available" },
  { state: "partially_checked", label: "Partially checked" }, { state: "needs_attention", label: "Needs attention" },
];
export const defaultPriceUpdatesFilters: PriceUpdatesFilters = { q: "", status: "", method: "all" };

/** Reads ?q=, ?status= (the old ?state= still works) and ?method=. A status must be one of the known states, otherwise it is ignored. */
export function parsePriceUpdatesFilters(get: (key: string) => string | null | undefined, knownStates: string[]): PriceUpdatesFilters {
  const status = (get("status") ?? get("state") ?? "").trim(), method = (get("method") ?? "").toLowerCase();
  return { q: (get("q") ?? "").trim().slice(0, 100), status: knownStates.includes(status) ? status : "", method: method === "codes" ? "codes" : method === "manual" ? "manual" : "all" };
}

const matchesSearch = (row: PriceUpdatesRow, q: string) => !q.trim() || row.name.toLowerCase().includes(q.trim().toLowerCase());
const matchesMethod = (row: PriceUpdatesRow, method: PriceUpdatesMethod) => method === "all" || (!row.failed && row.method === method);

/** A Brand whose status could not be read has no state, so it is shown only when no status is chosen (as before). */
export function filterPriceUpdates<T extends PriceUpdatesRow>(rows: T[], filters: PriceUpdatesFilters): T[] {
  return rows.filter((row) => matchesSearch(row, filters.q) && matchesMethod(row, filters.method) && (!filters.status || (!row.failed && row.state === filters.status)));
}

/** Chip counts follow the search and the method filter but not the status filter, so a chip always says how many it would show. */
export function chipCounts(rows: PriceUpdatesRow[], filters: Pick<PriceUpdatesFilters, "q" | "method">): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(priceUpdatesChips.map((chip) => [chip.state, 0]));
  for (const row of rows) if (!row.failed && matchesSearch(row, filters.q) && matchesMethod(row, filters.method) && row.state in counts) counts[row.state] += 1;
  return counts;
}

/** Clicking a chip filters by its status; clicking the same chip again clears it. */
export const toggleStatusChip = (filters: PriceUpdatesFilters, state: string): PriceUpdatesFilters => ({ ...filters, status: filters.status === state ? "" : state });

/** The query string for the address bar: other parameters are kept, the old ?state= is dropped, defaults are left out. */
export function priceUpdatesFilterQuery(filters: PriceUpdatesFilters, current: string | URLSearchParams = ""): string {
  const next = new URLSearchParams(typeof current === "string" ? current : current.toString());
  next.delete("state");
  if (filters.q.trim()) next.set("q", filters.q.trim()); else next.delete("q");
  if (filters.status) next.set("status", filters.status); else next.delete("status");
  if (filters.method !== "all") next.set("method", filters.method); else next.delete("method");
  const text = next.toString();
  return text ? `?${text}` : "";
}

export const priceUpdatesCountText = (shown: number, total: number) => `${shown} of ${total} brands`;
export const noPriceUpdatesText = (q: string) => q.trim() ? `No brands match "${q.trim()}".` : "No brands match the filters.";
