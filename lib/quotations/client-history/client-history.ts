/**
 * Client Quote History (server side, stage B). PURE: no React, no server-only, no database, never throws.
 * The history rows themselves are written ONLY by a database trigger; the browser can only read, search and delete them.
 * Nothing here ever holds a recipe, a payload or a price that is logged.
 */
import { normaliseSearchKey } from "../../products/saved-setups/collection-view";
import { isUuid } from "../../products/saved-setups/recipe";

export const CLIENT_HISTORY_PAGE_SIZE = 30;
export const CLIENT_HISTORY_SPEC_PREVIEW_CHARS = 160;
export const CLIENT_HISTORY_SEARCH_MAX = 80;
export const CLIENT_HISTORY_PICTURE_URL_SECONDS = 600;
export const CLIENT_HISTORY_PICTURE_URLS_MAX = 60;
export const CLIENT_HISTORY_KINDS = ["configured", "library", "custom"] as const;
export type ClientHistoryKind = (typeof CLIENT_HISTORY_KINDS)[number];

export type ClientHistoryMessageKind =
  | "not_allowed"
  | "invalid_request"
  | "item_not_found"
  | "wrong_client"
  | "product_unavailable"
  | "not_a_custom_item"
  | "load_failed"
  | "delete_failed"
  | "add_failed"
  | "picture_gone"
  | "picture_failed";

/** ONE place for the friendly text. Never a path, an id, a price or raw database text. */
export const CLIENT_HISTORY_MESSAGES: Record<ClientHistoryMessageKind, string> = {
  not_allowed: "You are not allowed to do this. Please sign in again.",
  invalid_request: "Something is missing or not valid. Please check it and try again.",
  item_not_found: "This history item was not found. It may have been removed.",
  wrong_client: "This history item belongs to a different client.",
  product_unavailable: "This product is no longer available in the Product Library.",
  not_a_custom_item: "This history item is not a manual item. Add it from the Product Library instead.",
  load_failed: "The client history could not be loaded. Please try again.",
  delete_failed: "The history item could not be removed. Please try again.",
  add_failed: "The item could not be added. Please try again.",
  picture_gone: "The old picture is no longer available, so the row was added without it.",
  picture_failed: "The picture could not be copied, so the row was added without it.",
};

export function clientHistoryMessage(kind: ClientHistoryMessageKind): string {
  return CLIENT_HISTORY_MESSAGES[kind];
}

export function isClientHistoryKind(value: unknown): value is ClientHistoryKind {
  return typeof value === "string" && (CLIENT_HISTORY_KINDS as readonly string[]).includes(value);
}

export function isHistoryId(value: unknown): value is string {
  return isUuid(value);
}

/** Row ids made by the local builder are short safe tokens (the same rule the My Collection picture copy uses). */
export function isSafeRowId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

/** Page numbers start at 1. Anything unreadable becomes page 1; the page is capped so a huge value cannot be requested. */
export function clampHistoryPage(value: unknown): number {
  const page = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.floor(page), 1), 10_000);
}

/** Same idea as My Collection: lower case, ignore spaces, dashes, underscores and dots ("EV-211" = "ev211"). */
export function normaliseHistoryText(value: unknown): string {
  return normaliseSearchKey(value);
}

/**
 * The text typed into the search box, made safe for a LIKE search: trimmed, whitespace collapsed, cut to 80 characters,
 * and the characters that are special to the database filter ( , ( ) " ) replaced by a space. Returns "" for nothing to search.
 */
export function cleanHistoryQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[,()"]/g, " ").replace(/\s+/g, " ").trim().slice(0, CLIENT_HISTORY_SEARCH_MAX);
}

/**
 * The LIKE pattern for a search: "%" + the text + "%", with % and _ (and the escape character itself) escaped so they only
 * match themselves. The escape is written for a value that is placed inside double quotes in a PostgREST filter, where a
 * backslash has to be doubled; a doubled backslash reaches the database as one escape character.
 */
export function historySearchPattern(value: unknown): string | null {
  const text = cleanHistoryQuery(value);
  if (!text) return null;
  const escaped = text.replace(/\\/g, "").replace(/%/g, "\\\\%").replace(/_/g, "\\\\_");
  return `%${escaped}%`;
}

// ── Price difference ───────────────────────────────────────────────────────
export type PriceChange = { difference: number; percent: number | null; direction: "up" | "down" | "same" };

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function currencyKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/**
 * Last quoted price vs today's price: only when BOTH currencies are known and equal (a different currency is not compared).
 * difference = today - last; percent = difference / last (null when the last price is 0).
 */
export function priceChange(last: { price: unknown; currency: unknown }, current: { price: unknown; currency: unknown }): PriceChange | null {
  const lastPrice = finiteNumber(last.price);
  const currentPrice = finiteNumber(current.price);
  const lastCurrency = currencyKey(last.currency);
  if (lastPrice === null || currentPrice === null || !lastCurrency || lastCurrency !== currencyKey(current.currency)) return null;
  const difference = money(currentPrice - lastPrice);
  return {
    difference,
    percent: lastPrice === 0 ? null : money((difference / lastPrice) * 100),
    direction: difference > 0 ? "up" : difference < 0 ? "down" : "same",
  };
}

// ── What the browser receives ──────────────────────────────────────────────
export type ClientHistoryPriceEntry = { price: number; currency: string; qty: number | null; at: string | null; quotationNo: string | null };

/**
 * Where the picture comes from: a product's own picture (the same path My Collection cards give to SetupThumbnail), a short-lived
 * signed link (custom rows), or nothing.
 */
export type ClientHistoryPicture = { kind: "template"; path: string } | { kind: "signed"; url: string } | null;

export type ClientHistoryListItem = {
  id: string;
  kind: ClientHistoryKind;
  itemName: string;
  brand: string;
  itemCode: string;
  specShort: string;
  unitLabel: string;
  qty: number | null;
  currency: string;
  lastUnitPrice: number;
  lastQuotedAt: string;
  lastQuotationNo: string | null;
  hasRecipe: boolean;
  templateId: string | null;
  picture: ClientHistoryPicture;
  priceHistory: ClientHistoryPriceEntry[];
};

/** The first characters of a specification for a list card, cut at a word end where possible. */
export function specPreview(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= CLIENT_HISTORY_SPEC_PREVIEW_CHARS) return text;
  const cut = text.slice(0, CLIENT_HISTORY_SPEC_PREVIEW_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > 100 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** last_prices (jsonb, newest first, at most 5) -> a clean small list. Anything unreadable is dropped. */
export function readPriceHistory(value: unknown): ClientHistoryPriceEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ClientHistoryPriceEntry[] = [];
  for (const entry of value.slice(0, 5)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const price = finiteNumber(record.price);
    if (price === null || typeof record.currency !== "string") continue;
    entries.push({
      price,
      currency: record.currency,
      qty: finiteNumber(record.qty),
      at: typeof record.at === "string" ? record.at : null,
      quotationNo: typeof record.quotation_no === "string" ? record.quotation_no : null,
    });
  }
  return entries;
}
