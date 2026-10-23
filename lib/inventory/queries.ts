import "server-only";

import { requireInventoryUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canSeeCosts, canViewInventory } from "./access";
import { InventoryPageRangeError } from "./page-range-error";
import { buildProductFilters, movementFilters, pagination, requestFilters } from "./filters";
import { CATEGORY_COLUMNS, COST_COLUMNS, IMAGE_COLUMNS, MOVEMENT_COLUMNS, MOVEMENT_REQUEST_COLUMNS, PRODUCT_COLUMNS, PRODUCT_REQUEST_COLUMNS, STOCK_COLUMNS, SUMMARY_COLUMNS, categoryTree, pageResult, pick, summarizeStock } from "./mapping";
import type { StockRow } from "./mapping";
import type { InventoryBrand, InventoryCategory, InventoryCosts, InventoryImage, InventoryImageRow, InventoryMovement, InventoryMovementRequest, InventoryMovementRequestRow, InventoryMovementRow, InventoryOverview, InventoryPage, InventoryProduct, InventoryProductDetail, InventoryProductRequest, InventoryProductRequestRow, InventoryProductRow, InventoryProductSummary, MovementFilters, ProductFilters, ProductRequestFilters, RequestFilters } from "./types";

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
  const data = rows(await client.schema("public").from("profiles").select("id,full_name").in("id", unique).returns<{ id: string; full_name: string | null }[]>());
  // Profiles hidden by RLS keep their identifier and a null display name.
  return new Map(data.map(row => [row.id, row.full_name]));
}
async function productSummaries(client: Client, productIds: (string | null)[]) {
  const unique = ids(productIds);
  if (!unique.length) return new Map<string, InventoryProductSummary>();
  const data = rows(await client.schema("inventory").from("products").select(SUMMARY_COLUMNS.join(",")).in("id", unique).returns<InventoryProductSummary[]>());
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

/** Active products only. Sold is a cumulative bucket, excluded from live quantity. */
export async function getInventoryOverview(): Promise<InventoryOverview> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const [stock, productRequests, movementRequests] = await Promise.all([
    allRows<StockRow>((from, to) => client.schema("inventory").from("products").select(STOCK_COLUMNS.join(","), { count: "exact" }).eq("is_active", true).order("id").range(from, to).returns<StockRow[]>()),
    client.schema("inventory").from("product_requests").select("id", { count: "exact", head: true }).eq("request_status", "pending_review"),
    client.schema("inventory").from("movement_requests").select("id", { count: "exact", head: true }).eq("request_status", "pending_review"),
  ]);
  return { ...summarizeStock(stock), pending_product_requests: total(productRequests), pending_movement_requests: total(movementRequests) };
}

export async function listProducts(filters: ProductFilters = {}, page = 1): Promise<InventoryPage<InventoryProduct>> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const plan = buildProductFilters(filters), range = pagination(page);
  let query = client.schema("inventory").from("products").select(PRODUCT_COLUMNS.join(","), { count: "exact" });
  if (plan.active !== null) query = query.eq("is_active", plan.active);
  if (plan.search) query = query.or(plan.search);
  for (const key of ["brand_id", "category_id", "subcategory_id", "status", "item_type"] as const) if (plan[key] !== null) query = query.eq(key, plan[key]);
  if (plan.location_column) query = query.gt(plan.location_column, 0);
  const response = await query.order(plan.order.column, { ascending: plan.order.ascending }).order("id").range(range.from, range.to).returns<InventoryProductRow[]>();
  if (response.status === 416 && response.error?.code === "PGRST103") throw new InventoryPageRangeError();
  const products = rows(response), productIds = products.map(row => row.id);
  const [labels, costs, imageRows] = await Promise.all([
    names(client, products), costRows(client, canSeeCosts(profile?.role), "product_costs", productIds),
    productIds.length ? client.schema("inventory").from("product_images").select(IMAGE_COLUMNS.join(",")).in("product_id", productIds).eq("is_main", true).returns<InventoryImageRow[]>().then(rows) : [],
  ]);
  const images = await signedImages(client, imageRows);
  const mainImages = new Map(images.map(row => [row.product_id, row.signed_url]));
  return pageResult(products.map(row => ({ ...pick(row, PRODUCT_COLUMNS), ...labels(row), main_image_url: mainImages.get(row.id) ?? null, ...(costs.has(row.id) ? { costs: costs.get(row.id)! } : {}) })), total(response), range.page, range.page_size);
}

export async function getProduct(id: string): Promise<InventoryProductDetail | null> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const product = rows(await client.schema("inventory").from("products").select(PRODUCT_COLUMNS.join(",")).eq("id", id).limit(1).returns<InventoryProductRow[]>())[0];
  if (!product) return null;
  const [labels, costs, imageRows, movementRows] = await Promise.all([
    names(client, [product]), costRows(client, canSeeCosts(profile?.role), "product_costs", [id]),
    client.schema("inventory").from("product_images").select(IMAGE_COLUMNS.join(",")).eq("product_id", id).order("sort_order").order("id").limit(3).returns<InventoryImageRow[]>().then(rows),
    client.schema("inventory").from("movements").select(MOVEMENT_COLUMNS.join(",")).eq("product_id", id).order("created_at", { ascending: false }).order("id").limit(20).returns<InventoryMovementRow[]>().then(rows),
  ]);
  const [images, movements] = await Promise.all([signedImages(client, imageRows), enrichMovements(client, movementRows)]);
  return { ...pick(product, PRODUCT_COLUMNS), ...labels(product), main_image_url: images.find(row => row.is_main)?.signed_url ?? null, images, recent_movements: movements, ...(costs.has(id) ? { costs: costs.get(id)! } : {}) };
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
  const plan = requestFilters(filters), productPlan = buildProductFilters(filters), range = pagination(filters.page);
  let query = client.schema("inventory").from("product_requests").select(PRODUCT_REQUEST_COLUMNS.join(","), { count: "exact" });
  for (const key of ["request_status", "submitted_by"] as const) if (plan[key] !== null) query = query.eq(key, plan[key]);
  for (const key of ["brand_id", "category_id", "subcategory_id", "item_type"] as const) if (productPlan[key] !== null) query = query.eq(key, productPlan[key]);
  if (productPlan.search) query = query.or(productPlan.search);
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
  const response = await query.order("submitted_at", { ascending: false }).order("id").range(range.from, range.to).returns<InventoryMovementRequestRow[]>();
  if (response.status === 416 && response.error?.code === "PGRST103") throw new InventoryPageRangeError();
  const requests = rows(response);
  const [products, people] = await Promise.all([productSummaries(client, requests.map(row => row.product_id)), displayNames(client, requests.map(row => row.submitted_by))]);
  return pageResult(requests.map(row => ({ ...pick(row, MOVEMENT_REQUEST_COLUMNS), product: products.get(row.product_id) ?? null, submitter_display_name: people.get(row.submitted_by) ?? null })), total(response), range.page, range.page_size);
}

export async function listMovements(filters: MovementFilters = {}, page = 1): Promise<InventoryPage<InventoryMovement>> {
  const { profile } = await requireInventoryUser();
  const client = await inventoryClient(profile?.role);
  const plan = movementFilters(filters), range = pagination(page);
  let query = client.schema("inventory").from("movements").select(MOVEMENT_COLUMNS.join(","), { count: "exact" });
  for (const key of ["product_id", "created_by", "movement_type"] as const) if (plan[key] !== null) query = query.eq(key, plan[key]);
  if (plan.location) query = query.or(`from_location.eq.${plan.location},to_location.eq.${plan.location}`);
  if (plan.from) query = query.gte("created_at", plan.from);
  if (plan.to) query = query.lte("created_at", plan.to);
  const response = await query.order("created_at", { ascending: false }).order("id").range(range.from, range.to).returns<InventoryMovementRow[]>();
  return pageResult(await enrichMovements(client, rows(response)), total(response), range.page, range.page_size);
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
