import { ITEM_TYPES, LOCATION_QUANTITY_COLUMNS, MOVEMENT_ACTIONS, MOVEMENT_TYPES, PRODUCT_STATUSES, STOCK_FILTERS, REQUEST_STATUSES, REQUEST_TYPES } from "./types";
import type { MovementFilters, ProductFilters, ProductSort, RequestFilters } from "./types";

export const PAGE_SIZE = 24;
export function pagination(page = 1) {
  if (!Number.isSafeInteger(page) || page < 1 || page > Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE)) {
    throw new Error("Invalid inventory page");
  }
  return { page, page_size: PAGE_SIZE, from: (page - 1) * PAGE_SIZE, to: page * PAGE_SIZE - 1 };
}
function allowed<T extends string>(value: T | undefined, options: readonly T[]): T | null {
  if (value === undefined) return null;
  if (!options.includes(value)) throw new Error("Invalid inventory filter");
  return value;
}
export function searchFilter(search?: string): string | null {
  const text = search?.trim().slice(0, 200);
  if (!text) return null;
  const escaped = text.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  // PostgREST quoted values keep commas, parentheses and quotes inside the value.
  const pattern = JSON.stringify(`%${escaped}%`);
  return ["item_name", "item_code", "stock_ref", "model_name"].map(field => `${field}.ilike.${pattern}`).join(",");
}
const orders = {
  name_asc: { column: "item_name", ascending: true }, name_desc: { column: "item_name", ascending: false },
  newest: { column: "created_at", ascending: false }, oldest: { column: "created_at", ascending: true },
  quantity_asc: { column: "quantity", ascending: true }, quantity_desc: { column: "quantity", ascending: false },
} as const;
export function buildProductFilters(filters: ProductFilters = {}) {
  const sort = allowed(filters.sort, Object.keys(orders) as ProductSort[]) ?? "name_asc";
  const location = allowed(filters.location, Object.keys(LOCATION_QUANTITY_COLUMNS) as (keyof typeof LOCATION_QUANTITY_COLUMNS)[]);
  if (filters.active !== undefined && filters.active !== "all" && typeof filters.active !== "boolean") throw new Error("Invalid inventory filter");
  return {
    active: filters.active === "all" ? null : filters.active ?? true,
    search: searchFilter(filters.search), brand_id: filters.brand_id ?? null,
    category_id: filters.category_id ?? null, subcategory_id: filters.subcategory_id ?? null,
    status: allowed(filters.status, PRODUCT_STATUSES), item_type: allowed(filters.item_type, ITEM_TYPES),
    stock: allowed(filters.stock, STOCK_FILTERS),
    location_column: location ? LOCATION_QUANTITY_COLUMNS[location] : null,
    order: orders[sort],
  };
}
/** Free text for people or product lookups: trimmed, bounded, and safe inside a PostgREST ilike. */
export function lookupText(value?: string): string | null {
  const text = value?.trim().slice(0, 100).replace(/[\%_,()*"]/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
}
/** Request search: product fields for everyone, plus submitter ids that only managers are given. */
export function requestSearchFilter(productFields: string | null, personIds: readonly string[]): string | null {
  const parts = [productFields, personIds.length ? `submitted_by.in.(${personIds.join(",")})` : null].filter((part): part is string => !!part);
  return parts.length ? parts.join(",") : null;
}
export function requestFilters(filters: RequestFilters = {}) {
  return {
    search: lookupText(filters.search),
    request_status: allowed(filters.request_status, REQUEST_STATUSES),
    request_type: allowed(filters.request_type, REQUEST_TYPES),
    submitted_by: filters.submitted_by ?? null, product_id: filters.product_id ?? null,
  };
}
export function movementFilters(filters: MovementFilters = {}) {
  function date(value?: string) {
    if (value === undefined) return null;
    if (!Number.isFinite(Date.parse(value))) throw new Error("Invalid inventory date");
    return new Date(value).toISOString();
  }
  const from = date(filters.from), to = date(filters.to);
  if (from && to && from > to) throw new Error("Invalid inventory date range");
  return {
    product_id: filters.product_id ?? null, created_by: filters.created_by ?? null,
    movement_type: allowed(filters.movement_type, MOVEMENT_TYPES), action_type: allowed(filters.action_type, MOVEMENT_ACTIONS),
    search: filters.search?.trim().slice(0,100) || null, person: lookupText(filters.person),
    location: allowed(filters.location, Object.keys(LOCATION_QUANTITY_COLUMNS) as (keyof typeof LOCATION_QUANTITY_COLUMNS)[]),
    from, to, new_items: filters.new_items === true,
  };
}
