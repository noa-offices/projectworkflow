import type { CurrentInventoryFilters, MovementReportFilters } from "./params";

const withQuery = (path: string, pairs: [string, string | undefined | false][]) => {
  const query = new URLSearchParams();
  for (const [key, value] of pairs) if (value) query.set(key, value);
  const text = query.toString();
  return `${path}${text ? `?${text}` : ""}`;
};
export const currentReportUrl = (filters: CurrentInventoryFilters, format: "xlsx" | "pdf") => withQuery("/api/inventory/reports/current", [
  ["format", format], ["brand", filters.brand], ["category", filters.category], ["itemType", filters.itemType], ["location", filters.location], ["status", filters.status],
  ["soldOut", filters.includeSoldOut && "1"], ["photos", format === "pdf" && filters.photos && "1"],
]);
export const movementsReportUrl = (filters: MovementReportFilters) => withQuery("/api/inventory/reports/movements", [
  ["from", filters.from], ["to", filters.to], ["product", filters.product], ["action", filters.action], ["location", filters.location], ["person", filters.person.trim()],
]);
/** File name from a Content-Disposition header, or the fallback. */
export function downloadName(header: string | null, fallback: string): string {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) { try { return decodeURIComponent(star); } catch { /* use the plain name */ } }
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}
