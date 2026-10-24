import { ITEM_TYPES, LOCATION_LABELS, MOVEMENT_ACTIONS, PRODUCT_STATUSES } from "../types";
import type { InventoryLocation, ItemType, MovementAction, ProductStatus } from "../types";
import { dubaiDateKey, dubaiDayBounds, isValidDateKey, shiftDateKey } from "./format";

type Raw = URLSearchParams | Record<string, string | string[] | undefined>;
const get = (raw: Raw, key: string): string => {
  const value = raw instanceof URLSearchParams ? raw.get(key) : Array.isArray(raw[key]) ? raw[key]![0] : raw[key];
  return (value ?? "").trim();
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const allowed = <T extends string>(value: string, choices: readonly T[]): T | "" | null => value === "" ? "" : (choices as readonly string[]).includes(value) ? value as T : null;

export const MAX_REPORT_RANGE_DAYS = 366;
export type CurrentInventoryFilters = { brand: string; category: string; itemType: ItemType | ""; location: InventoryLocation | ""; status: ProductStatus | ""; includeSoldOut: boolean; photos: boolean; excelPhotos: boolean };
export type MovementReportFilters = { from: string; to: string; product: string; action: MovementAction | ""; location: InventoryLocation | ""; person: string; photos: boolean };

/** Every query parameter is checked against an allow-list, a UUID shape or a real date. */
export function parseCurrentInventoryParams(raw: Raw): ParseResult<CurrentInventoryFilters & { format: "xlsx" | "pdf" }> {
  const format = get(raw, "format") === "pdf" ? "pdf" : get(raw, "format") === "xlsx" || get(raw, "format") === "" ? "xlsx" : null;
  if (!format) return fail("Choose Excel or PDF.");
  const brand = get(raw, "brand"), category = get(raw, "category");
  if ((brand && !UUID.test(brand)) || (category && !UUID.test(category))) return fail("Choose a brand and category from the list.");
  const itemType = allowed(get(raw, "itemType"), ITEM_TYPES), location = allowed(get(raw, "location"), Object.keys(LOCATION_LABELS) as InventoryLocation[]), status = allowed(get(raw, "status"), PRODUCT_STATUSES);
  if (itemType === null) return fail("Choose an item type from the list.");
  if (location === null) return fail("Choose a location from the list.");
  if (status === null) return fail("Choose a status from the list.");
  return { ok: true, value: { format, brand: brand.toLowerCase(), category: category.toLowerCase(), itemType, location, status, includeSoldOut: get(raw, "soldOut") === "1", photos: get(raw, "photos") === "1", excelPhotos: get(raw, "excelPhotos") !== "0" } };
}
/** Date range is required. It defaults to the last 30 Dubai days and may not run backwards or past one year. */
export function parseMovementReportParams(raw: Raw, now: Date = new Date()): ParseResult<MovementReportFilters & { bounds: { from: string; to: string } }> {
  const today = dubaiDateKey(now);
  const from = get(raw, "from") || shiftDateKey(today, -29), to = get(raw, "to") || today;
  if (!isValidDateKey(from) || !isValidDateKey(to)) return fail("Enter the dates as day, month and year.");
  if (to < from) return fail("The end date must be on or after the start date.");
  if (shiftDateKey(from, MAX_REPORT_RANGE_DAYS) < to) return fail("Choose a date range of one year or less.");
  const product = get(raw, "product");
  if (product && !UUID.test(product)) return fail("Choose a product from the list.");
  const action = allowed(get(raw, "action"), MOVEMENT_ACTIONS), location = allowed(get(raw, "location"), Object.keys(LOCATION_LABELS) as InventoryLocation[]);
  if (action === null) return fail("Choose an action from the list.");
  if (location === null) return fail("Choose a location from the list.");
  return { ok: true, value: { from, to, product: product.toLowerCase(), action, location, person: get(raw, "person").slice(0, 100), photos: get(raw, "photos") !== "0", bounds: dubaiDayBounds(from, to) } };
}
export function defaultMovementRange(now: Date = new Date()) { const to = dubaiDateKey(now); return { from: shiftDateKey(to, -29), to }; }
