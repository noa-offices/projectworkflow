/**
 * Client Quote History (server side, stage B). PURE: no React, no server-only, no database, never throws.
 * The history rows themselves are written ONLY by a database trigger; the browser can only read, search and delete them.
 * Nothing here ever holds a recipe, a payload or a price that is logged.
 */
import { normaliseSearchKey } from "../../products/saved-setups/collection-view";
import { isUuid } from "../../products/saved-setups/recipe";
import { normalizeCurrency } from "../../currencies";

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
export type ClientHistoryDiscountType = "percent" | "amount";

/**
 * The list price and discount of a line, read from the three database columns (or from a last_prices entry). All three are set
 * together or all three are null: a discount needs its value AND a list price, a percent is at most 100, nothing is guessed.
 * Rows recorded before the update have none of them (then the line is just its net price).
 */
export type ClientHistoryLineDiscount = { listUnitPrice: number | null; discountType: ClientHistoryDiscountType | null; discountValue: number | null };

export function readLineDiscount(listUnitPrice: unknown, discountType: unknown, discountValue: unknown): ClientHistoryLineDiscount {
  const list = finiteNumber(listUnitPrice);
  const value = finiteNumber(discountValue);
  const listOk = list !== null && list > 0 ? list : null;
  if ((discountType === "percent" || discountType === "amount") && value !== null && value > 0 && listOk !== null && (discountType !== "percent" || value <= 100)) {
    return { listUnitPrice: listOk, discountType, discountValue: value };
  }
  return { listUnitPrice: listOk, discountType: null, discountValue: null };
}

export type ClientHistoryPriceEntry = {
  price: number;
  currency: string;
  qty: number | null;
  at: string | null;
  quotationNo: string | null;
  /** Only present on entries recorded after the list price / discount update. */
  listPrice?: number;
  discountType?: ClientHistoryDiscountType;
  discountValue?: number;
};

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
  /** The ORIGINAL unit price before the discount; null on rows recorded before the update (then there is no list/discount to show). */
  listUnitPrice: number | null;
  discountType: ClientHistoryDiscountType | null;
  discountValue: number | null;
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
    const line = readLineDiscount(record.list_price, record.discount_type, record.discount_value);
    entries.push({
      price,
      currency: record.currency,
      qty: finiteNumber(record.qty),
      at: typeof record.at === "string" ? record.at : null,
      quotationNo: typeof record.quotation_no === "string" ? record.quotation_no : null,
      ...(line.listUnitPrice !== null ? { listPrice: line.listUnitPrice } : {}),
      ...(line.discountType !== null && line.discountValue !== null ? { discountType: line.discountType, discountValue: line.discountValue } : {}),
    });
  }
  return entries;
}

// ── Adding a CUSTOM history item as the same line ──────────────────────────
export type HistoryCustomLineInput = {
  price: number;
  currency: string;
  listUnitPrice: number | null;
  discountType: ClientHistoryDiscountType | null;
  discountValue: number | null;
  qty: number | null;
};

/**
 * What goes on the new row, BEFORE the existing pricing helpers compute net price and net total:
 *  - same currency as the quote: unit price = the list price (or the last price when the row has none), the stored discount, the last qty;
 *  - a different currency: the price is NOT converted here; the row gets price 0 (rowOverlayFromCustomItem) and NO discount, so no wrong
 *    numbers appear. The source price kept for the user to convert is the NET price that was actually charged.
 * qty is the last quoted quantity (1 when missing or not a positive number).
 */
export function historyCustomLine(item: HistoryCustomLineInput, quoteCurrency: string | null | undefined): {
  sellingPrice: number;
  sameCurrency: boolean;
  discountType: "percent" | "amount";
  discountValue: number;
  qty: number;
} {
  const sameCurrency = normalizeCurrency(item.currency) === normalizeCurrency(quoteCurrency);
  const qty = item.qty !== null && Number.isFinite(item.qty) && item.qty > 0 ? item.qty : 1;
  const line = readLineDiscount(item.listUnitPrice, item.discountType, item.discountValue);
  if (!sameCurrency) return { sellingPrice: item.price, sameCurrency, discountType: "amount", discountValue: 0, qty };
  return {
    sellingPrice: line.listUnitPrice ?? item.price,
    sameCurrency,
    discountType: line.discountType ?? "amount",
    discountValue: line.discountValue ?? 0,
    qty,
  };
}
