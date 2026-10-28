import "server-only";

import { requireInventoryUser } from "@/lib/auth";
import { canViewInventory } from "@/lib/inventory/access";
import { searchFilter } from "@/lib/inventory/filters";
import { isActiveReservation, reservationTotals } from "@/lib/inventory/reservations";
import { createClient } from "@/lib/supabase/server";
import type { NoaCapabilityResult, NoaPageContext } from "./noa-types";

// Read-only Inventory answers. Reads inventory.products with an explicit column list only: no costs, prices, notes, descriptions,
// user ids or photos, and the cost tables are never queried. Items are always active items; RLS (the caller's own client) stays the gate.
export const INVENTORY_REPORTS = ["list", "count", "item_stock", "low_stock", "by_location", "by_category"] as const;
export const INVENTORY_LOCATIONS = ["warehouse", "dubai_showroom", "abudhabi_showroom", "mockup", "temporary_out"] as const;
export type NoaInventoryReport = typeof INVENTORY_REPORTS[number];
export type NoaInventoryLocation = typeof INVENTORY_LOCATIONS[number];
export type NoaInventoryOptions = { report: NoaInventoryReport; term?: string; location?: NoaInventoryLocation; category?: string };

const MAX_ROWS = 20;
const MAX_CHOICES = 5;
const MAX_TEXT = 80;
const BATCH = 1000;
// Letters, digits, spaces and . - & ' / # only: no wildcard, comma, quote, parenthesis or backslash characters.
const TEXT_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .\-&'/#]*$/u;
const COLUMNS = [
  "id", "item_name", "model_name", "stock_ref", "item_code", "item_type", "status", "condition", "is_active", "location", "brand_id", "local_brand_id", "category_id", "subcategory_id",
  "warehouse_quantity", "dubai_showroom_quantity", "abudhabi_showroom_quantity", "mockup_quantity", "temporary_out_quantity", "sold_quantity", "quantity", "low_stock_at",
].join(",");
const LOCATION_COLUMN: Record<NoaInventoryLocation, string> = {
  warehouse: "warehouse_quantity", dubai_showroom: "dubai_showroom_quantity", abudhabi_showroom: "abudhabi_showroom_quantity",
  mockup: "mockup_quantity", temporary_out: "temporary_out_quantity",
};

type ProductRow = {
  id: string; item_name: string; model_name: string | null; stock_ref: string | null; item_code: string | null; item_type: string; status: string; condition: string;
  is_active: boolean; location: string | null; brand_id: string | null; local_brand_id: string | null; category_id: string; subcategory_id: string | null;
  warehouse_quantity: number; dubai_showroom_quantity: number; abudhabi_showroom_quantity: number; mockup_quantity: number; temporary_out_quantity: number;
  sold_quantity: number; quantity: number; low_stock_at: number | null;
};
type ReservationRow = { product_id: string; quantity: number; status: string; expires_at: string | null };
type NameRow = { id: string; name: string };
type CategoryRow = NameRow & { parent_id: string | null };
type Client = Awaited<ReturnType<typeof createClient>>;
type ProductQuery = ReturnType<ReturnType<ReturnType<Client["schema"]>["from"]>["select"]>;

const UNAUTHORIZED: NoaCapabilityResult = { message: "I couldn't access Inventory for this account.", ok: false, reason: "unauthorized" };
const refuse = (message: string): NoaCapabilityResult => ({ message, ok: false, reason: "ambiguous" });
const notFound = (message: string): NoaCapabilityResult => ({ message, ok: false, reason: "not_found" });
const sources = (recordId?: string) => [{ label: "Inventory", type: "inventory", ...(recordId ? { recordId } : {}) }];

/** Returns the trimmed text, null when absent, or undefined when present but not valid. */
function cleanText(value: string | undefined): string | null | undefined {
  if (value === undefined) return null;
  const text = value.trim();
  return text.length >= 1 && text.length <= MAX_TEXT && TEXT_PATTERN.test(text) ? text : undefined;
}
const escapeLike = (text: string) => text.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
function must<T>(result: { data: T | null; error: unknown }): T {
  if (result.error || result.data === null) throw new Error("Unable to read inventory data");
  return result.data;
}

/** Brand names matching the text, shared and local, as extra product filters (same idea as the Inventory page search). */
async function brandFilters(client: Client, text: string): Promise<string[]> {
  const like = `%${escapeLike(text)}%`;
  const [shared, local] = await Promise.all([
    client.schema("public").from("brands").select("id").ilike("name", like).limit(200).returns<{ id: string }[]>(),
    client.schema("inventory").rpc("read_local_brand_names", {}, { get: true }).ilike("name", like).limit(200).returns<{ id: string }[]>(),
  ]);
  const sharedIds = must(shared as { data: { id: string }[] | null; error: unknown }).map(row => row.id);
  const localIds = must(local as { data: { id: string }[] | null; error: unknown }).map(row => row.id);
  return [sharedIds.length ? `brand_id.in.(${sharedIds.join(",")})` : "", localIds.length ? `local_brand_id.in.(${localIds.join(",")})` : ""].filter(Boolean);
}
/** Category ids whose name matches (exact first, else contains), including their subcategories. Null when nothing matches. */
async function categoryIds(client: Client, text: string): Promise<string[] | null> {
  const all = must(await client.schema("inventory").from("categories").select("id,parent_id,name").returns<CategoryRow[]>() as { data: CategoryRow[] | null; error: unknown });
  const needle = text.toLowerCase();
  const exact = all.filter(row => row.name.toLowerCase() === needle);
  const matched = exact.length ? exact : all.filter(row => row.name.toLowerCase().includes(needle));
  if (!matched.length) return null;
  const ids = new Set(matched.map(row => row.id));
  for (const row of all) if (row.parent_id && ids.has(row.parent_id)) ids.add(row.id);
  return [...ids];
}
async function labels(client: Client, rows: ProductRow[]) {
  const brandIds = [...new Set(rows.map(row => row.brand_id).filter((id): id is string => !!id))];
  const localIds = [...new Set(rows.map(row => row.local_brand_id).filter((id): id is string => !!id))];
  const categories = [...new Set(rows.flatMap(row => [row.category_id, row.subcategory_id]).filter((id): id is string => !!id))];
  const [brands, locals, cats] = await Promise.all([
    brandIds.length ? client.schema("public").from("brands").select("id,name").in("id", brandIds).returns<NameRow[]>() : { data: [] as NameRow[], error: null },
    localIds.length ? client.schema("inventory").rpc("read_local_brand_names", {}, { get: true }).in("id", localIds).returns<NameRow[]>() : { data: [] as NameRow[], error: null },
    categories.length ? client.schema("inventory").from("categories").select("id,name").in("id", categories).returns<NameRow[]>() : { data: [] as NameRow[], error: null },
  ]);
  const name = (result: unknown) => new Map(must(result as { data: NameRow[] | null; error: unknown }).map(row => [row.id, row.name]));
  const brandMap = name(brands), localMap = name(locals), categoryMap = name(cats);
  return (row: ProductRow) => ({
    brand: (row.local_brand_id ? localMap.get(row.local_brand_id) : row.brand_id ? brandMap.get(row.brand_id) : null) ?? null,
    category: categoryMap.get(row.category_id) ?? null,
    subcategory: row.subcategory_id ? categoryMap.get(row.subcategory_id) ?? null : null,
  });
}
async function shapeItems(client: Client, rows: ProductRow[]) {
  const ids = rows.map(row => row.id);
  const [label, reservations] = await Promise.all([
    labels(client, rows),
    ids.length ? client.schema("inventory").from("reservations").select("product_id,quantity,status,expires_at").in("product_id", ids).eq("status", "active").returns<ReservationRow[]>() : { data: [] as ReservationRow[], error: null },
  ]);
  const active = must(reservations as { data: ReservationRow[] | null; error: unknown }).filter(row => isActiveReservation(row));
  return rows.map(row => {
    const totals = reservationTotals(row.quantity, active.filter(reservation => reservation.product_id === row.id));
    return {
      id: row.id, name: row.item_name, modelName: row.model_name, stockRef: row.stock_ref, itemCode: row.item_code, itemType: row.item_type, status: row.status, condition: row.condition,
      location: row.location, ...label(row),
      buckets: { warehouse: row.warehouse_quantity, dubaiShowroom: row.dubai_showroom_quantity, abudhabiShowroom: row.abudhabi_showroom_quantity, mockup: row.mockup_quantity, temporaryOut: row.temporary_out_quantity },
      sold: row.sold_quantity, quantity: row.quantity, reserved: totals.reserved_quantity, available: Math.max(0, totals.available_quantity), lowStockAt: row.low_stock_at,
    };
  });
}

// The context is part of the shared capability signature; Inventory answers do not depend on the page.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function fetchNoaInventoryCapability(options: NoaInventoryOptions, _context?: NoaPageContext): Promise<NoaCapabilityResult> {
  const { report } = options;
  if (!(INVENTORY_REPORTS as readonly string[]).includes(report)) return refuse("That Inventory request is not available in NOA. Prices and costs of Inventory are never shown.");
  if (options.location !== undefined && !(INVENTORY_LOCATIONS as readonly string[]).includes(options.location)) return refuse("The location must be warehouse, dubai_showroom, abudhabi_showroom, mockup or temporary_out.");
  const term = cleanText(options.term), category = cleanText(options.category);
  if (term === undefined || category === undefined) return refuse("The search text is not valid. Use letters, digits, spaces and basic punctuation, 80 characters at most.");
  if (report === "item_stock" && !term) return refuse("Tell me which item to check (name, stock reference or item code).");
  if (report === "by_location" && !options.location) return refuse("Tell me which location: warehouse, dubai_showroom, abudhabi_showroom, mockup or temporary_out.");
  if (report === "by_category" && !category) return refuse("Tell me which category.");

  let role: string | null | undefined;
  try { role = (await requireInventoryUser()).profile?.role; } catch { return UNAUTHORIZED; }
  if (role === "warehouse_staff" || !canViewInventory(role)) return UNAUTHORIZED;

  try {
    const client = await createClient();
    const categoryFilter = category ? await categoryIds(client, category) : null;
    if (category && !categoryFilter) return notFound(`I couldn't find an Inventory category matching "${category}".`);
    const search = term ? [searchFilter(term), ...(await brandFilters(client, term))].filter(Boolean).join(",") : "";
    const filtered = (query: ProductQuery): ProductQuery => {
      let next = query.eq("is_active", true);
      if (options.location) next = next.gt(LOCATION_COLUMN[options.location], 0);
      if (categoryFilter) next = next.or(`category_id.in.(${categoryFilter.join(",")}),subcategory_id.in.(${categoryFilter.join(",")})`);
      if (search) next = next.or(search);
      return next;
    };
    const products = () => client.schema("inventory").from("products");

    if (report === "count") {
      const { count, error } = await filtered(products().select("id", { count: "exact", head: true }));
      if (error || count == null) throw new Error("Unable to count inventory data");
      return { ok: true, data: { report, count }, sources: sources() };
    }

    const page = async (from: number, to: number) => {
      const response = await filtered(products().select(COLUMNS, { count: "exact" })).order("item_name").order("id").range(from, to).returns<ProductRow[]>();
      if (response.error || !response.data || response.count == null) throw new Error("Unable to read inventory data");
      return { rows: response.data, total: response.count };
    };

    if (report === "item_stock") {
      const { rows, total } = await page(0, MAX_CHOICES);
      if (total === 0) return notFound(`I couldn't find an Inventory item matching "${term}".`);
      const items = await shapeItems(client, rows.slice(0, MAX_CHOICES));
      if (total === 1) return { ok: true, data: { report, total, items }, sources: sources(items[0].id) };
      return { ok: true, data: { report, total, needsChoice: true, items, message: `${total} items match "${term}". Which one do you mean? Use its name, stock reference or item code.` }, sources: sources() };
    }

    let shown: ProductRow[], total: number;
    if (report === "low_stock") {
      const all: ProductRow[] = [];
      while (true) {
        const batch = await page(all.length, all.length + BATCH - 1);
        all.push(...batch.rows);
        if (all.length >= batch.total) break;
        if (batch.rows.length === 0) throw new Error("Incomplete inventory data");
      }
      // Rule: quantity <= low_stock_at, whenever a threshold exists.
      const low = all.filter(row => row.low_stock_at !== null && row.quantity <= row.low_stock_at);
      total = low.length; shown = low.slice(0, MAX_ROWS);
    } else {
      const batch = await page(0, MAX_ROWS - 1);
      total = batch.total; shown = batch.rows;
    }
    const items = await shapeItems(client, shown);
    const truncated = total > items.length;
    return { ok: true, data: { report, total, shown: items.length, truncated, ...(truncated ? { truncation: `Showing the first ${items.length} of ${total}. Narrow by brand, category or location.` } : {}), items }, sources: sources() };
  } catch {
    return notFound("I couldn't read Inventory right now.");
  }
}
