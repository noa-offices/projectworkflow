import { isBrandSelection } from "./brands";
import { formatDubaiDateTime } from './date-time';
import { ITEM_TYPES, LOCATION_LABELS, LOCATION_QUANTITY_COLUMNS, PRODUCT_STATUSES, STOCK_FILTERS } from "./types";
import type { InventoryImage, InventoryLocation, InventoryProductRow, ProductFilters, ProductSort, StockBuckets } from "./types";

export type InventorySearchParams = Record<string, string | string[] | undefined>;
export type ProductUrlState = { stock: string; q: string; brand: string; category: string; subcategory: string; status: string; itemType: string; location: string; sort: ProductSort; page: number };
export const PRODUCT_SORT_LABELS = { name_asc: "Name: A–Z", name_desc: "Name: Z–A", newest: "Newest first", oldest: "Oldest first", quantity_asc: "Quantity: low to high", quantity_desc: "Quantity: high to low" } as const;
export function isInventoryProductId(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
export function parseInventoryProductParams(params: InventorySearchParams) {
  const first = (key: string) => { const value = params[key]; return (Array.isArray(value) ? value[0] : value) ?? ""; };
  const identifier = (key: string) => isInventoryProductId(first(key)) ? first(key).toLowerCase() : "";
  const allowed = (key: string, choices: readonly string[]) => choices.includes(first(key)) ? first(key) : "";
  const rawPage = first("page"), page = /^\d+$/.test(rawPage) && Number(rawPage) >= 1 && Number(rawPage) <= 1000000 ? Number(rawPage) : 1;
  const state: ProductUrlState = {
    stock: allowed("stock", STOCK_FILTERS), q: first("q").trim().slice(0, 200), brand: isBrandSelection(first("brand")) ? first("brand").toLowerCase() : "", category: identifier("category"), subcategory: identifier("subcategory"),
    status: allowed("status", PRODUCT_STATUSES), itemType: allowed("itemType", ITEM_TYPES), location: allowed("location", Object.keys(LOCATION_LABELS)),
    sort: (allowed("sort", Object.keys(PRODUCT_SORT_LABELS)) || "name_asc") as ProductSort, page,
  };
  const filters: ProductFilters = {
    search: state.q || undefined, brand_id: state.brand || undefined, category_id: state.category || undefined,
    subcategory_id: state.subcategory || undefined, status: state.status as ProductFilters["status"] || undefined,
    item_type: state.itemType as ProductFilters["item_type"] || undefined, location: state.location as InventoryLocation || undefined, stock: state.stock as ProductFilters["stock"] || undefined, sort: state.sort,
  };
  return { state, filters, page };
}
export function inventoryProductsHref(state: ProductUrlState, patch: Partial<ProductUrlState> = {}, baseHref = "/inventory/products") {
  const next = { ...state, ...patch }, [path, fixed] = baseHref.split("?", 2), query = new URLSearchParams(fixed);
  for (const key of ["q", "brand", "category", "subcategory", "status", "itemType", "location", "stock"] as const) {
    if (next[key]) query.set(key, next[key]); else query.delete(key);
  }
  if (next.sort !== "name_asc") query.set("sort", next.sort); else query.delete("sort");
  if (next.page > 1) query.set("page", String(next.page)); else query.delete("page");
  const suffix = query.toString();
  return `${path}${suffix ? `?${suffix}` : ""}`;
}
/** Overview card destination; the Products page reads the same parameters back. */
export function inventoryOverviewHref(filter: { itemType?: string; location?: string; stock?: string }, baseHref = "/inventory/products") {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);
  const suffix = query.toString();
  return `${baseHref}${suffix ? `?${suffix}` : ""}`;
}
export function hasInventoryFilters(state: ProductUrlState): boolean { return !!(state.q || state.brand || state.category || state.subcategory || state.status || state.itemType || state.location || state.stock); }
export function inventoryOptionalText(value: string | null | undefined): string { return value?.trim() || "—"; }
export function inventoryLabel(value: string): string {
  const special: Record<string, string> = { receive_stock: "Stock received", stock_in: "Stock in", stock_out: "Stock out", return_to_warehouse: "Return to warehouse", internal_transfer: "Internal transfer", project_balance: "Project balance", manual_entry: "Manual entry", temporary_out: "Temporary out", pending_review: "Pending review" };
  const label = special[value] ?? value.replaceAll("_", " ");
  return label ? label[0].toUpperCase() + label.slice(1) : "Unknown";
}
export function formatInventoryNumber(value: number): string { return new Intl.NumberFormat("en-US").format(value); }
export function formatInventoryDate(value: string): string {
  return formatDubaiDateTime(value) || 'Unknown date';
}
/** Only full_name is passed here. Never use email as a display-name fallback. */
export function inventoryPersonName(value: string | null | undefined): string {
  const name = value?.trim();
  return name && !name.includes('@') && name.toLowerCase() !== 'unknown' ? name : 'Team member';
}
export function productStockLocations(product: StockBuckets) {
  return (Object.keys(LOCATION_LABELS) as InventoryLocation[]).map(code => ({ code, label: LOCATION_LABELS[code], quantity: product[LOCATION_QUANTITY_COLUMNS[code]], cumulative: code === "sold" }));
}
export function dimensionLabel(product: Pick<InventoryProductRow, "dimension_length" | "dimension_width" | "dimension_height" | "dimension_unit">): string | null {
  const { dimension_length: length, dimension_width: width, dimension_height: height, dimension_unit: unit } = product;
  return length !== null && width !== null && height !== null && unit ? `${formatInventoryNumber(length)} × ${formatInventoryNumber(width)} × ${formatInventoryNumber(height)} ${unit}` : null;
}
export function orderedProductImages(images: InventoryImage[]): InventoryImage[] {
  return [...images].sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.sort_order - b.sort_order || a.id.localeCompare(b.id)).slice(0, 3);
}
