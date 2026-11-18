import { formatMoney } from "@/lib/currencies";
import { formatSavedDate } from "@/lib/products/saved-setups/collection-view";
import { priceChange, type ClientHistoryListItem, type ClientHistoryPriceEntry } from "./client-history";

// Pure display helpers for the "Add from {client} history" popup. No server code, no I/O: prices come from the list the
// server action already returned, money uses the app's formatter and dates are Asia/Dubai (formatSavedDate).

export const CLIENT_HISTORY_KIND_FILTERS = [
  { value: "all", label: "All" },
  { value: "configured", label: "Configured" },
  { value: "library", label: "Library" },
  { value: "custom", label: "Custom" },
] as const;

export type ClientHistoryKindFilter = (typeof CLIENT_HISTORY_KIND_FILTERS)[number]["value"];

export const CLIENT_HISTORY_KIND_LABELS: Record<ClientHistoryListItem["kind"], string> = {
  configured: "Configured",
  library: "Library",
  custom: "Custom",
};

/** "Last quoted AED 1,250.00 · 12 Oct 2026 · QF-0107-001" (parts that are missing are left out). */
export function lastQuotedLine(item: Pick<ClientHistoryListItem, "currency" | "lastUnitPrice" | "lastQuotedAt" | "lastQuotationNo">): string {
  const date = formatSavedDate(item.lastQuotedAt);
  return [`Last quoted ${formatMoney(item.currency, item.lastUnitPrice)}`, date, item.lastQuotationNo ?? ""].filter(Boolean).join(" · ");
}

/**
 * "▲ 50.00 (4.2%) vs previous" / "▼ ..." for the last price against the nearest OLDER price in the SAME currency. A price in
 * another currency is never compared (null). "Unchanged" when the two prices are equal.
 */
export function previousPriceChangeText(item: Pick<ClientHistoryListItem, "currency" | "lastUnitPrice" | "priceHistory">): string | null {
  const history = item.priceHistory ?? [];
  // Newest first. The first entry is normally the last quote itself; skip it when it is the same price.
  const first = history[0];
  const older = first && first.price === item.lastUnitPrice && first.currency === item.currency ? history.slice(1) : history;
  const previous = older.find((entry) => entry.currency.trim().toUpperCase() === item.currency.trim().toUpperCase());
  if (!previous) return null;
  const change = priceChange({ price: previous.price, currency: previous.currency }, { price: item.lastUnitPrice, currency: item.currency });
  if (!change) return null;
  if (change.direction === "same") return "Unchanged vs previous";
  const amount = formatMoney(item.currency, Math.abs(change.difference)).replace(/^[A-Z]{3}\s/, "");
  const percent = change.percent === null ? "" : ` (${Math.abs(change.percent).toFixed(1)}%)`;
  return `${change.direction === "up" ? "▲" : "▼"} ${amount}${percent} vs previous`;
}

/** One line of the quiet "price history" list: "AED 1,250.00 · qty 4 · 12 Oct 2026 · QF-0107-001". */
export function priceHistoryLine(entry: ClientHistoryPriceEntry): string {
  const date = formatSavedDate(entry.at);
  return [formatMoney(entry.currency, entry.price), entry.qty === null ? "" : `qty ${entry.qty}`, date, entry.quotationNo ?? ""].filter(Boolean).join(" · ");
}

/** The client name for the button label (long names are shortened; the full name stays in the title). */
export function shortClientName(name: string | null | undefined, max = 24): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
