import "server-only";

import { requireInventoryUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canSeeCosts, canViewInventory, canManageInventory, canSubmitHoldBook } from "./access";
import { InventoryPageRangeError } from "./page-range-error";
import { ReportTooLargeError } from "./reports/movements-report";
import type { CurrentInventoryRow } from "./reports/current-inventory";
import type { CurrentInventoryFilters } from "./reports/params";
import { buildProductFilters, lookupText, movementFilters, pagination, requestFilters, requestSearchFilter, searchFilter } from "./filters";
import { CATEGORY_COLUMNS, COST_COLUMNS, IMAGE_COLUMNS, MOVEMENT_COLUMNS, MOVEMENT_REQUEST_COLUMNS, PRODUCT_COLUMNS, PRODUCT_REQUEST_COLUMNS, STOCK_COLUMNS, SUMMARY_COLUMNS, categoryTree, pageResult, pick, summarizeStock, withCategoryCounts } from "./mapping";
import type { StockRow } from "./mapping";
import type { InventoryCategoryOverview, InventoryMovementLink, InventoryBrand, InventoryCategory, InventoryCosts, InventoryImage, InventoryImageRow, InventoryMovement, InventoryMovementRequest, InventoryMovementRequestRow, InventoryMovementRow, InventoryOverview, InventoryPage, InventoryProduct, InventoryProductDetail, InventoryProductRequest, InventoryProductRequestRow, InventoryProductRow, InventoryProductSummary, MovementFilters, ProductFilters, ProductRequestFilters, RequestFilters } from "./types";

import { isActiveReservation, reservationTotals } from "./reservations";
import type { InventoryReservationRow, InventoryReservation, InventoryProjectOption } from "./types";
import { ITEM_TYPES, LOCATION_QUANTITY_COLUMNS } from "./types";
import type { ProductTypeCounts } from "./types";

type Client = Awaited<ReturnType<typeof createClient>>;
type ReadResult<T> = { data: T[] | null; error: unknown; count?: number | null };
const BATCH_SIZE = 1000;
const IMAGE_BUCKET = "inventory-images";
const IMAGE_TTL = 3600;

async function inventoryClient(role: string | null | undefined) {
  if (!canViewInventory(role)) throw new Error("Inventory access denied");
  return createClient();
}
function rows<T>(result: ReadResult<T>): T[] {
  if (result.error || !result.data) throw new Error("Unable to read inventory data");
  return result.data;
}
function total(result: { error: unknown; count?: number | null }): number {
  if (result.error || result.count == null) throw new Error("Unable to count inventory data");
  return result.count;
}
// The API may cap responses below the requested batch size. Advance by actual rows.
async function allRows<T>(read: (from: number, to: number) => PromiseLike<ReadResult<T>>): Promise<T[]> {
  const result: T[] = [];
  while (true) {
    const response = await read(result.length, result.length + BATCH_SIZE - 1);
    const batch = rows(response), count = total(response);
    result.push(...batch);
    if (result.length >= count) return result;
    if (batch.length === 0) throw new Error("Incomplete inventory data");
  }
}
const ID_CHUNK = 150;
/** Long id lists are read in chunks so a request address never grows too long. */
async function inChunks<T>(values: string[], read: (part: string[]) => PromiseLike<T[]>): Promise<T[]> {
  const parts: string[][] = [];
  for (let index = 0; index < values.length; index += ID_CHUNK) parts.push(values.slice(index, index + ID_CHUNK));
  return (await Promise.all(parts.map(read))).flat();
}
const ids = (values: (string | null | undefined)[]) => [...new Set(values.filter((value): value is string => !!value))];

async function names(client: Client, products: { brand_id: string; category_id: string; subcategory_id: string | null }[]) {
  const brands = ids(products.map(row => row.brand_id));
  const categories = ids(products.flatMap(row => [row.category_id, row.subcategory_id]));
  const [brandRows, categoryRows] = await Promise.all([
    brands.length ? client.schema("public").from("brands").select("id,name").in("id", brands).returns<InventoryBrand[]>().then(rows) : [],
    categories.length ? client.schema("inventory").from("categories").select("id,name").in("id", categories).returns<InventoryBrand[]>().then(rows) : [],
  ]);
  const brandMap = new Map(brandRows.map(row => [row.id, row.name]));
  const categoryMap = new Map(categoryRows.map(row => [row.id, row.name]));
  return (row: typeof products[number]) => ({
    brand_name: brandMap.get(row.brand_id) ?? null,
    category_name: categoryMap.get(row.category_id) ?? null,
    subcategory_name: row.subcategory_id ? categoryMap.get(row.subcategory_id) ?? null : null,
  });
}
async function displayNames(client: Client, userIds: string[]) {
  const unique = ids(userIds);
  if (!unique.length) return new Map<string, string | null>();
  const data = await inChunks(unique, part => client.schema("public").from("profiles").select("id,full_name").in("id", part).returns<{ id: string; full_name: string | null }[]>().then(rows));
  // Profiles hidden by RLS keep their identifier and a null display name.
  return new Map(data.map(row => [row.id, row.full_name]));
}
async function productSummaries(client: Client, productIds: (string | null)[]) {
  const unique = ids(productIds);
  if (!unique.length) return new Map<string, InventoryProductSummary>();
  const data = await inChunks(unique, part => client.schema("inventory").from("products").select(SUMMARY_COLUMNS.join(",")).in("id", part).returns<InventoryProductSummary[]>().then(rows));
  return new Map(data.map(row => [row.id, pick(row, SUMMARY_COLUMNS)]));
}
async function costRows(client: Client, allowed: boolean, table: "product_costs" | "product_request_costs", ownerIds: string[]) {
  const result = new Map<string, InventoryCosts>();
  if (!allowed || !ownerIds.length) return result;
  const key = table === "product_costs" ? "product_id" : "product_request_id";
  const data = rows(await client.schema("inventory").from(table).select([key, ...COST_COLUMNS].join(",")).in(key, ownerIds).returns<(InventoryCosts & { product_id?: string; product_request_id?: string })[]>());
  for (const row of data) {
    const id = row[key];
    if (id) result.set(id, pick(row, COST_COLUMNS));
  }
  return result;
}
async function signedImages(client: Client, images: InventoryImageRow[]): Promise<InventoryImage[]> {
  const paths = ids(images.filter(row => row.storage_bucket === IMAGE_BUCKET).map(row => row.storage_path));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data, error } = await client.storage.from(IMAGE_BUCKET).createSignedUrls(paths, IMAGE_TTL);
    if (!error) for (const row of data ?? []) {
      if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl);
    }
  }
  return images.map(row => ({ ...pick(row, IMAGE_COLUMNS), signed_url: row.storage_bucket === IMAGE_BUCKET ? urls.get(row.storage_path) ?? null : null }));
}
async function enrichMovements(client: Client, movements: InventoryMovementRow[]): Promise<InventoryMovement[]> {
  const [products, people] = await Promise.all([
    productSummaries(client, movements.map(row => row.product_id)),
    displayNames(client, movements.map(row => row.created_by)),
  ]);
  return movements.map(row => ({ ...pick(row, MOVEMENT_COLUMNS), product: products.get(row.product_id) ?? null, actor_display_name: people.get(row.created_by) ?? null }));
}


const RESERVATION_COLUMNS = ["id", "product_id", "kind", "quantity", "status", "project_id", "project_label", "reference_note", "expires_at", "note", "created_by", "created_at", "source_request_id", "released_by", "released_at", "release_note", "fulfilled_movement_id"] as const satisfies readonly (keyof InventoryReservationRow)[];
async function activeReservations(client: Client, productIds: string[]): Promise<InventoryReservationRow[]> {
  if (!productIds.length) return [];
  const data = await allRows<InventoryReservationRow>((from,to) => client.schema("inventory").from("reservations").select(RESERVATION_COLUMNS.join(","), {count:"exact"}).in("product_id",productIds).eq("status","active").order("created_at",{ascending:false}).order("id").range(from,to).returns<InventoryReservationRow[]>());
  const now = new Date();
  return data.filter(row => isActiveReservation(row,now)).map(row => pick(row, RESERVATION_COLUMNS));
}

const MAX_LOOKUP_IDS = 200;
/** Ids of products whose name, stock ref, item code or model match the text (any active state). */
async function matchingProductIds(client: Client, text: string | null): Promise<string[] | null> {
  const filter = searchFilter(text ?? undefined);
  if (!filter) return null;
  return rows(await client.schema("inventory").from("products").select("id").or(filter).order("id").limit(MAX_LOOKUP_IDS).returns<{ id: string }[]>()).map(row => row.id);
}
/** Ids of people whose name matches. Only managers may search by name. */
async function matchingPersonIds(client: Client, role: string | null | undefined, text: string | null): Promise<string[]> {
  if (!text || !canManageInventory(role)) return [];
  return rows(await client.schema("public").from("profiles").select("id").ilike("full_name", `%${text}%`).order("id").limit(100).returns<{ id: string }[]>()).map(row => row.id);
}
function emptyPage<T>(page: number): InventoryPage<T> { return pageResult<T>([], 0, page, pagination(page).page_size); }

/** Active products only. Sold is a cumulative bucket, excluded from live quantity. */
export async function getInventoryOverview(): Promise<InventoryOverview> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const [stock, productRequests, movementRequests] = await Promise.all([
    allRows<StockRow & { id: string }>((from, to) => client.schema("inventory").from("products").select(["id",...STOCK_COLUMNS].join(","), { count: "exact" }).eq("is_active", true).order("id").range(from, to).returns<(StockRow & { id: string })[]>()),
    client.schema("inventory").from("product_requests").select("id", { count: "exact", head: true }).eq("request_status", "pending_review"),
    client.schema("inventory").from("movement_requests").select("id", { count: "exact", head: true }).eq("request_status", "pending_review"),
  ]);
  const reservations = await activeReservations(client, stock.map(row => row.id));
  return { reserved_quantity: reservations.reduce((sum,row) => sum + row.quantity,0), reserved_product_count: new Set(reservations.map(row => row.product_id)).size, ...summarizeStock(stock), pending_product_requests: total(productRequests), pending_movement_requests: total(movementRequests) };
}

type ProductReadQuery = ReturnType<ReturnType<ReturnType<Client['schema']>['from']>['select']>;
/** Product ids for filters that cannot be expressed as a single column comparison. Same rules as the Overview counts. */
async function stockFilterIds(client: Client, plan: ReturnType<typeof buildProductFilters>): Promise<string[] | null> {
  if (plan.stock !== "reserved") return null;
  const stock = await allRows<StockRow & { id: string }>((from, to) => client.schema("inventory").from("products").select(["id", ...STOCK_COLUMNS].join(","), { count: "exact" }).eq("is_active", true).order("id").range(from, to).returns<(StockRow & { id: string })[]>());
  return ids((await activeReservations(client, stock.map(row => row.id))).map(row => row.product_id));
}
function applyProductFilters(query: ProductReadQuery, plan: ReturnType<typeof buildProductFilters>, stockIds: string[] | null = null) {
  if (plan.stock === "live") query = query.gt("quantity", 0);
  if (stockIds) query = query.in("id", stockIds);
  if (plan.active !== null) query = query.eq("is_active", plan.active);
  if (plan.search) query = query.or(plan.search);
  for (const key of ["brand_id", "category_id", "subcategory_id", "status", "item_type"] as const) if (plan[key] !== null) query = query.eq(key, plan[key]);
  if (plan.location_column) query = query.gt(plan.location_column, 0);
  return query;
}

/** Counts every matching row using the caller's RLS, independent of the current type/page. */
export async function getProductTypeCounts(filters: ProductFilters = {}): Promise<ProductTypeCounts> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const plan = buildProductFilters({ ...filters, item_type: undefined }), stockIds = await stockFilterIds(client, plan);
  const counts = await Promise.all(ITEM_TYPES.map(async itemType => total(await applyProductFilters(
    client.schema("inventory").from("products").select("id", { count: "exact", head: true }),
    { ...plan, item_type: itemType }, stockIds,
  ))));
  const [product, accessory, temporary] = counts;
  return { all: product + accessory + temporary, product, accessory, temporary };
}

export async function listProducts(filters: ProductFilters = {}, page = 1): Promise<InventoryPage<InventoryProduct>> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const plan = buildProductFilters(filters), range = pagination(page), stockIds = await stockFilterIds(client, plan);
  const query = applyProductFilters(client.schema("inventory").from("products").select(PRODUCT_COLUMNS.join(","), { count: "exact" }), plan, stockIds);
  const response = await query.order(plan.order.column, { ascending: plan.order.ascending }).order("id").range(range.from, range.to).returns<InventoryProductRow[]>();
  if (response.status === 416 && response.error?.code === "PGRST103") throw new InventoryPageRangeError();
  const products = rows(response), productIds = products.map(row => row.id);
  const [labels, costs, imageRows, reservations] = await Promise.all([
    names(client, products), costRows(client, canSeeCosts(profile?.role), "product_costs", productIds),
    productIds.length ? client.schema("inventory").from("product_images").select(IMAGE_COLUMNS.join(",")).in("product_id", productIds).eq("is_main", true).returns<InventoryImageRow[]>().then(rows) : [],
    activeReservations(client, productIds),
  ]);
  const images = await signedImages(client, imageRows);
  const mainImages = new Map(images.map(row => [row.product_id, row.signed_url]));
  return pageResult(products.map(row => ({ ...pick(row, PRODUCT_COLUMNS), ...reservationTotals(row.quantity,reservations.filter(reservation => reservation.product_id === row.id)), ...labels(row), main_image_url: mainImages.get(row.id) ?? null, ...(costs.has(row.id) ? { costs: costs.get(row.id)! } : {}) })), total(response), range.page, range.page_size);
}

export async function getProduct(id: string): Promise<InventoryProductDetail | null> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const product = rows(await client.schema("inventory").from("products").select(PRODUCT_COLUMNS.join(",")).eq("id", id).limit(1).returns<InventoryProductRow[]>())[0];
  if (!product) return null;
  const [labels, costs, imageRows, movementRows, reservationRows] = await Promise.all([
    names(client, [product]), costRows(client, canSeeCosts(profile?.role), "product_costs", [id]),
    client.schema("inventory").from("product_images").select(IMAGE_COLUMNS.join(",")).eq("product_id", id).order("sort_order").order("id").limit(3).returns<InventoryImageRow[]>().then(rows),
    client.schema("inventory").from("movements").select(MOVEMENT_COLUMNS.join(",")).eq("product_id", id).order("created_at", { ascending: false }).order("id").limit(10).returns<InventoryMovementRow[]>().then(rows),
    activeReservations(client, [id]),
  ]);
  const people = await displayNames(client,reservationRows.map(row => row.created_by));
  const reservations: InventoryReservation[] = reservationRows.map(row => ({...row,creator_display_name:people.get(row.created_by) ?? null}));
  const [images, movements] = await Promise.all([signedImages(client, imageRows), enrichMovements(client, movementRows)]);
  return { ...pick(product, PRODUCT_COLUMNS), ...reservationTotals(product.quantity,reservations), reservations, ...labels(product), main_image_url: images.find(row => row.is_main)?.signed_url ?? null, images, recent_movements: movements, ...(costs.has(id) ? { costs: costs.get(id)! } : {}) };
}

export async function listCategories() {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const categories = await allRows<InventoryCategory>((from, to) => client.schema("inventory").from("categories").select(CATEGORY_COLUMNS.join(","), { count: "exact" }).order("id").range(from, to).returns<InventoryCategory[]>());
  return categoryTree(categories);
}

export async function listActiveBrands(): Promise<InventoryBrand[]> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const brands = await allRows<InventoryBrand>((from, to) => client.schema("public").from("brands").select("id,name", { count: "exact" }).eq("is_active", true).order("name").order("id").range(from, to).returns<InventoryBrand[]>());
  return brands.map(row => pick(row, ["id", "name"]));
}

export async function listProductRequests(filters: ProductRequestFilters = {}): Promise<InventoryPage<InventoryProductRequest>> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const plan = requestFilters(filters), productPlan = buildProductFilters({ ...filters, search: lookupText(filters.search) ?? undefined }), range = pagination(filters.page);
  let query = client.schema("inventory").from("product_requests").select(PRODUCT_REQUEST_COLUMNS.join(","), { count: "exact" });
  for (const key of ["request_status", "submitted_by"] as const) if (plan[key] !== null) query = query.eq(key, plan[key]);
  for (const key of ["brand_id", "category_id", "subcategory_id", "item_type"] as const) if (productPlan[key] !== null) query = query.eq(key, productPlan[key]);
  const search = requestSearchFilter(productPlan.search, await matchingPersonIds(client, profile?.role, plan.search));
  if (search) query = query.or(search);
  const response = await query.order("submitted_at", { ascending: false }).order("id").range(range.from, range.to).returns<InventoryProductRequestRow[]>();
  if (response.status === 416 && response.error?.code === "PGRST103") throw new InventoryPageRangeError();
  const requests = rows(response);
  const [labels, people, costs, products] = await Promise.all([
    names(client, requests), displayNames(client, requests.map(row => row.submitted_by)),
    costRows(client, canSeeCosts(profile?.role), "product_request_costs", requests.map(row => row.id)),
    productSummaries(client, requests.map(row => row.approved_product_id)),
  ]);
  return pageResult(requests.map(row => ({ ...pick(row, PRODUCT_REQUEST_COLUMNS), ...labels(row), submitter_display_name: people.get(row.submitted_by) ?? null, approved_product: row.approved_product_id ? products.get(row.approved_product_id) ?? null : null, ...(costs.has(row.id) ? { costs: costs.get(row.id)! } : {}) })), total(response), range.page, range.page_size);
}

export async function listMovementRequests(filters: RequestFilters = {}): Promise<InventoryPage<InventoryMovementRequest>> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const plan = requestFilters(filters), range = pagination(filters.page);
  let query = client.schema("inventory").from("movement_requests").select(MOVEMENT_REQUEST_COLUMNS.join(","), { count: "exact" });
  for (const key of ["request_status", "submitted_by", "request_type", "product_id"] as const) if (plan[key] !== null) query = query.eq(key, plan[key]);
  if (plan.search) {
    const [productIds, personIds] = await Promise.all([matchingProductIds(client, plan.search), matchingPersonIds(client, profile?.role, plan.search)]);
    const parts = [productIds?.length ? `product_id.in.(${productIds.join(",")})` : null, personIds.length ? `submitted_by.in.(${personIds.join(",")})` : null].filter((part): part is string => !!part);
    if (!parts.length) return emptyPage(range.page);
    query = query.or(parts.join(","));
  }
  const response = await query.order("submitted_at", { ascending: false }).order("id").range(range.from, range.to).returns<InventoryMovementRequestRow[]>();
  if (response.status === 416 && response.error?.code === "PGRST103") throw new InventoryPageRangeError();
  const requests = rows(response);
  const [products, people] = await Promise.all([productSummaries(client, requests.map(row => row.product_id)), displayNames(client, requests.map(row => row.submitted_by))]);
  return pageResult(requests.map(row => ({ ...pick(row, MOVEMENT_REQUEST_COLUMNS), product: products.get(row.product_id) ?? null, submitter_display_name: people.get(row.submitted_by) ?? null })), total(response), range.page, range.page_size);
}

type MovementQuery = ReturnType<ReturnType<ReturnType<Client["schema"]>["from"]>["select"]>;
/** Applies the history filters. Returns null when a search or person matches nobody (so nothing can match). */
async function applyMovementFilters(client: Client, role: string | null | undefined, plan: ReturnType<typeof movementFilters>, query: MovementQuery): Promise<{ query: MovementQuery } | null> {
  for (const key of ["product_id", "created_by", "movement_type", "action_type"] as const) if (plan[key] !== null) query = query.eq(key, plan[key]);
  if (plan.search) {
    const productIds = await matchingProductIds(client, plan.search);
    if (!productIds?.length) return null;
    query = query.in("product_id", productIds);
  }
  if (plan.person) {
    const personIds = await matchingPersonIds(client, role, plan.person);
    if (!personIds.length) return null;
    query = query.in("created_by", personIds);
  }
  if (plan.location) query = query.or(`from_location.eq.${plan.location},to_location.eq.${plan.location}`);
  if (plan.from) query = query.gte("created_at", plan.from);
  if (plan.to) query = query.lte("created_at", plan.to);
  // Wrapped: a bare query builder is awaitable and would run if returned from an async function.
  return { query };
}
/** Adds the product photo and the linked request or reservation to each movement. */
async function withMovementDetails(client: Client, movements: InventoryMovementRow[], photos = true): Promise<InventoryMovement[]> {
  const movementIds = movements.map(row => row.id), productIds = ids(movements.map(row => row.product_id));
  const [enriched, imageRows, requestLinks, reservationLinks] = await Promise.all([
    enrichMovements(client, movements),
    photos ? inChunks(productIds, part => client.schema("inventory").from("product_images").select(IMAGE_COLUMNS.join(",")).in("product_id", part).eq("is_main", true).returns<InventoryImageRow[]>().then(rows)) : [],
    inChunks(movementIds, part => client.schema("inventory").from("movement_requests").select("id,approved_movement_id").in("approved_movement_id", part).returns<{ id: string; approved_movement_id: string }[]>().then(rows)),
    inChunks(movementIds, part => client.schema("inventory").from("reservations").select("id,fulfilled_movement_id").in("fulfilled_movement_id", part).returns<{ id: string; fulfilled_movement_id: string }[]>().then(rows)),
  ]);
  const images = new Map((await signedImages(client, imageRows)).map(row => [row.product_id, row.signed_url]));
  const links = new Map<string, InventoryMovementLink>();
  for (const row of requestLinks) links.set(row.approved_movement_id, { kind: "request", id: row.id });
  for (const row of reservationLinks) links.set(row.fulfilled_movement_id, { kind: "reservation", id: row.id });
  return enriched.map(row => ({ ...row, main_image_url: images.get(row.product_id) ?? null, linked: links.get(row.id) ?? (row.reference_type === "product_request" && row.reference_id ? { kind: "product_request" as const, id: row.reference_id } : null) }));
}

/** Manager movement history. Newest first; filters combine. */
export async function listMovements(filters: MovementFilters = {}, page = 1): Promise<InventoryPage<InventoryMovement>> {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) throw new Error("Inventory access denied");
  const client = await inventoryClient(profile?.role);
  const plan = movementFilters(filters), range = pagination(page);
  const filtered = await applyMovementFilters(client, profile?.role, plan, client.schema("inventory").from("movements").select(MOVEMENT_COLUMNS.join(","), { count: "exact" }));
  if (!filtered) return emptyPage(range.page);
  const response = await filtered.query.order("created_at", { ascending: false }).order("id").range(range.from, range.to).returns<InventoryMovementRow[]>();
  if (response.status === 416 && response.error?.code === "PGRST103") throw new InventoryPageRangeError();
  return pageResult(await withMovementDetails(client, rows(response)), total(response), range.page, range.page_size);
}

/** Every movement for the Excel report, paged through completely. Refuses more than the row limit. */
export async function listMovementsForReport(filters: MovementFilters, limit: number): Promise<InventoryMovement[]> {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) throw new Error("Inventory access denied");
  const client = await inventoryClient(profile?.role);
  const plan = movementFilters(filters);
  const counted = await applyMovementFilters(client, profile?.role, plan, client.schema("inventory").from("movements").select("id", { count: "exact", head: true }));
  if (!counted) return [];
  if (total(await counted.query) > limit) throw new ReportTooLargeError();
  const movements = await allRows<InventoryMovementRow>(async (from, to) => {
    const filtered = await applyMovementFilters(client, profile?.role, plan, client.schema("inventory").from("movements").select(MOVEMENT_COLUMNS.join(","), { count: "exact" }));
    return filtered!.query.order("created_at", { ascending: false }).order("id").range(from, to).returns<InventoryMovementRow[]>();
  });
  return withMovementDetails(client, movements, false);
}

const REPORT_COLUMNS = ["id", "stock_ref", "item_code", "item_name", "model_name", "brand_id", "category_id", "subcategory_id", "item_type", "status", "condition", "quantity", ...Object.values(LOCATION_QUANTITY_COLUMNS)].join(",");
type ReportProductRow = { id: string; stock_ref: string | null; item_code: string | null; item_name: string; model_name: string | null; brand_id: string; category_id: string; subcategory_id: string | null; item_type: string; status: string; condition: string; quantity: number } & Record<typeof LOCATION_QUANTITY_COLUMNS[keyof typeof LOCATION_QUANTITY_COLUMNS], number>;

/** Current inventory for the Excel and PDF report. Stock numbers only: costs are never read. */
export async function listCurrentInventoryReport(filters: CurrentInventoryFilters): Promise<{ rows: CurrentInventoryRow[]; brandName: string | null; categoryName: string | null }> {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) throw new Error("Inventory access denied");
  const client = await inventoryClient(profile?.role);
  const plan = buildProductFilters({ brand_id: filters.brand || undefined, category_id: filters.category || undefined, item_type: filters.itemType || undefined, location: filters.location || undefined, status: filters.status || undefined, active: true, stock: filters.includeSoldOut ? undefined : "live" });
  const products = await allRows<ReportProductRow>((from, to) => applyProductFilters(client.schema("inventory").from("products").select(REPORT_COLUMNS, { count: "exact" }), plan).order("item_name").order("id").range(from, to).returns<ReportProductRow[]>());
  const [labels, reservations, photoRows] = await Promise.all([
    names(client, products),
    allRows<InventoryReservationRow>((from, to) => client.schema("inventory").from("reservations").select(RESERVATION_COLUMNS.join(","), { count: "exact" }).eq("status", "active").order("id").range(from, to).returns<InventoryReservationRow[]>()),
    filters.photos ? inChunks(products.map(row => row.id), part => client.schema("inventory").from("product_images").select(IMAGE_COLUMNS.join(",")).in("product_id", part).eq("is_main", true).returns<InventoryImageRow[]>().then(rows)) : [],
  ]);
  const reserved = new Map<string, number>(), now = new Date();
  for (const row of reservations) if (isActiveReservation(row, now)) reserved.set(row.product_id, (reserved.get(row.product_id) ?? 0) + row.quantity);
  const photos = new Map((await signedImages(client, photoRows)).map(row => [row.product_id, row.signed_url]));
  const items = products.map<CurrentInventoryRow>(row => {
    const label = labels(row), held = reserved.get(row.id) ?? 0;
    return {
      stock_ref: row.stock_ref, item_code: row.item_code, item_name: row.item_name, model_name: row.model_name, brand: label.brand_name, category: label.category_name, subcategory: label.subcategory_name,
      item_type: row.item_type, status: row.status, condition: row.condition, warehouse: row.warehouse_quantity, dubai_showroom: row.dubai_showroom_quantity, abudhabi_showroom: row.abudhabi_showroom_quantity,
      mockup: row.mockup_quantity, temporary_out: row.temporary_out_quantity, total_live: row.quantity, reserved: held, available: row.quantity - held, sold: row.sold_quantity, photo_url: photos.get(row.id) ?? null,
    };
  });
  const [brandRows, categoryRows] = await Promise.all([
    filters.brand ? client.schema("public").from("brands").select("id,name").eq("id", filters.brand).limit(1).returns<InventoryBrand[]>().then(rows) : [],
    filters.category ? client.schema("inventory").from("categories").select("id,name").eq("id", filters.category).limit(1).returns<InventoryBrand[]>().then(rows) : [],
  ]);
  return { rows: items, brandName: brandRows[0]?.name ?? null, categoryName: categoryRows[0]?.name ?? null };
}

/** Categories with subcategories and how many active products use each. Managers only. */
export async function listCategoryOverview(): Promise<InventoryCategoryOverview[]> {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) throw new Error("Inventory access denied");
  const client = await inventoryClient(profile?.role);
  const [tree, products] = await Promise.all([
    listCategories(),
    allRows<{ id: string; category_id: string; subcategory_id: string | null }>((from, to) => client.schema("inventory").from("products").select("id,category_id,subcategory_id", { count: "exact" }).eq("is_active", true).order("id").range(from, to).returns<{ id: string; category_id: string; subcategory_id: string | null }[]>()),
  ]);
  return withCategoryCounts(tree, products);
}

export async function getProductRequestImages(requestId: string): Promise<InventoryImage[]> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const request = rows(await client.schema("inventory").from("product_requests").select("request_status,approved_product_id").eq("id", requestId).limit(1).returns<{request_status:string;approved_product_id:string|null}[]>())[0];
  if (!request) return [];
  // Approval relinks request photos to the resulting product.
  const productId = request.request_status === "approved" ? request.approved_product_id : null;
  const images = rows(await client.schema("inventory").from("product_images").select(IMAGE_COLUMNS.join(",")).eq(productId ? "product_id" : "product_request_id", productId ?? requestId).order("sort_order").order("id").limit(3).returns<InventoryImageRow[]>());
  return signedImages(client, images);
}

export async function getPendingProductMovementRequests(productId: string): Promise<InventoryMovementRequest[]> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const requests = await allRows<InventoryMovementRequestRow>((from, to) => client.schema("inventory").from("movement_requests").select(MOVEMENT_REQUEST_COLUMNS.join(","), { count: "exact" }).eq("product_id", productId).eq("request_status", "pending_review").order("submitted_at", { ascending: false }).order("id").range(from, to).returns<InventoryMovementRequestRow[]>());
  const people = await displayNames(client, requests.map(row => row.submitted_by));
  return requests.map(row => ({ ...pick(row, MOVEMENT_REQUEST_COLUMNS), product: null, submitter_display_name: people.get(row.submitted_by) ?? null }));
}

/** Uses the caller's public-table RLS; never exposes full project records. */
export async function listProjectsForInventory(search = ""): Promise<InventoryProjectOption[]> {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role) && !canSubmitHoldBook(profile?.role)) throw new Error("Inventory project access denied");
  const client = await inventoryClient(profile?.role);
  const term = search.trim().slice(0,100).replace(/[%,().*\\"]/g," ").trim();
  let matchingClients: {id:string}[] = [];
  if (term) matchingClients = await allRows<{id:string}>((from,to) => client.schema("public").from("clients").select("id",{count:"exact"}).ilike("company_name",`%${term}%`).order("id").range(from,to).returns<{id:string}[]>());
  let query = client.schema("public").from("projects").select("id,project_number,project_code,project_name,clients(company_name)");
  if (term) query = query.or([`project_number.ilike.%${term}%`,`project_code.ilike.%${term}%`,`project_name.ilike.%${term}%`,...(matchingClients.length ? [`client_id.in.(${matchingClients.map(row=>row.id).join(",")})`] : [])].join(","));
  const data = rows(await query.order("project_code").order("id").limit(20).returns<{id:string;project_number:string|null;project_code:string|null;project_name:string|null;clients:{company_name:string|null}|null}[]>());
  return data.map(row => ({id:row.id,label:[row.project_number || row.project_code,row.project_name,row.clients?.company_name].filter(Boolean).join(" \u00b7 ")}));
}
