import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

let role: string | null = "viewer";
let authError = false;
let clientCalls = 0;
let calls: { table: string; url: URL; schema: string | null; method: string; body?: Record<string, unknown> }[] = [];
let fixtures: Record<string, Record<string, unknown>[]>;
let cap = 1000;
let failTable: string | null = null;
let failSigning = false;
const product = { id: "p1", brand_id: "b1", category_id: "c1", subcategory_id: null, item_name: "Chair", item_code: "C1", stock_ref: "S1", model_name: "M1", quantity: 3, low_stock_at: 3, warehouse_quantity: 2, dubai_showroom_quantity: 1, abudhabi_showroom_quantity: 0, mockup_quantity: 0, temporary_out_quantity: 0, sold_quantity: 10, is_active: true, price: 999, total_cost: 999, costs: { price: 999 } };
const costs = { price: 10, freight_cost: 1, c_and_f: 2, transport: 3, custom_duty: 4, labour: 5, vat: 6, total_cost: 31 };
function reset(nextRole = "viewer") {
  role = nextRole; authError = false; clientCalls = 0; calls = []; cap = 1000; failTable = null; failSigning = false;
  fixtures = {
    products: [product], product_requests: [{ ...product, id: "r1", submitted_by: "hidden", approved_product_id: "p1", request_status: "pending_review" }],
    product_costs: [{ product_id: "p1", ...costs }], product_request_costs: [{ product_request_id: "r1", ...costs }],
    product_images: [0, 1, 2].map(i => ({ id: `i${i}`, product_id: "p1", storage_bucket: "inventory-images", storage_path: `p1/${i}.jpg`, sort_order: i, is_main: i === 0, public_url: "https://unused.example" })),
    categories: [{ id: "c1", name: "Seating", parent_id: null, sort_order: 0 }], brands: [{ id: "b1", name: "Brand", is_active: true }], profiles: [],
    movements: [{ id: "m1", product_id: "p1", created_by: "hidden", created_at: "2026-10-23T00:00:00Z" }],
    movement_requests: [{ id: "mr1", product_id: "p1", submitted_by: "hidden", request_type: "hold", request_status: "pending_review" }],
  };
}
const client = createSupabaseClient("https://inventory.test", "test-publishable-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const table = url.pathname.split("/").at(-1)!;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ table, url, schema: headers.get("Accept-Profile"), method, body });
    if (url.pathname.includes("/storage/")) {
      assert.equal(url.pathname, "/storage/v1/object/sign/inventory-images");
      assert.equal(method, "POST");
      assert.equal(body.expiresIn, 3600);
      if (failSigning) return Response.json({ message: "fixture signing failure" }, { status: 403 });
      return Response.json((body.paths as string[]).toReversed().map(path => ({ path, signedURL: `/object/sign/inventory-images/${path}?token=fixture`, error: null })));
    }
    assert.ok(["GET", "HEAD"].includes(method), "database calls must only read");
    assert.equal(headers.get("Accept-Profile"), ["brands", "profiles"].includes(table) ? "public" : "inventory");
    if (table === failTable) return Response.json({ message: "fixture failure" }, { status: 500 });
    let rows = fixtures[table] ?? [];
    for (const [key, value] of url.searchParams) {
      if (value.startsWith("eq.")) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (value.startsWith("in.(")) rows = rows.filter(row => value.slice(4, -1).split(",").includes(String(row[key])));
    }
    const total = rows.length;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Math.min(cap, Number(url.searchParams.get("limit") ?? cap));
    rows = rows.slice(offset, offset + limit);
    return new Response(method === "HEAD" ? null : JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json", "Content-Range": `${offset}-${offset + rows.length - 1}/${total}` } });
  } },
});
mock.module("server-only", { namedExports: {} });
mock.module("@/lib/auth", { namedExports: { requireInventoryUser: async () => {
  if (authError) throw new Error("authentication required");
  return { profile: { role, account_status: "active" }, user: { id: "self" } };
} } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => { clientCalls++; return client; } } });
const queries = await import("./queries");

test("six non-manager roles never query cost tables or receive cost fields", async () => {
  for (const nextRole of ["procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer", "warehouse_staff"]) {
    reset(nextRole);
    const detail = await queries.getProduct("p1");
    const products = await queries.listProducts();
    const requests = await queries.listProductRequests();
    const movementRequests = await queries.listMovementRequests();
    const movements = await queries.listMovements();
    assert.ok(detail);
    for (const row of [detail, ...products.items, ...requests.items]) {
      for (const key of Object.keys(costs).concat("costs")) assert.equal(key in row, false, `${nextRole}: ${key}`);
    }
    assert.equal(calls.some(call => call.table.includes("cost")), false, nextRole);
    assert.equal(requests.items[0].submitted_by, "hidden");
    assert.equal(requests.items[0].submitter_display_name, null);
    assert.equal(requests.items[0].approved_product?.item_name, "Chair");
    const serialized = JSON.stringify([detail, products, requests, movementRequests, movements]);
    for (const key of Object.keys(costs).concat("costs")) assert.equal(serialized.includes(`"${key}":`), false);
  }
});
test("missing costs are omitted, missing products return null, and image failures never use public URLs", async () => {
  reset("admin_manager");
  fixtures.product_costs = [];
  fixtures.product_request_costs = [];
  failSigning = true;
  const detail = await queries.getProduct("p1");
  assert.equal("costs" in detail!, false);
  assert.ok(detail!.images.every(image => image.signed_url === null));
  assert.equal(detail!.main_image_url, null);
  assert.equal("costs" in (await queries.listProductRequests()).items[0], false);
  assert.equal(await queries.getProduct("missing"), null);
  reset();
  fixtures.product_images[0].storage_bucket = "other-bucket";
  assert.equal((await queries.listProducts()).items[0].main_image_url, null);
  assert.equal(calls.some(call => call.method === "POST"), false);
});
test("both managers receive explicitly selected costs and batched signed images", async () => {
  for (const nextRole of ["system_owner", "admin_manager"]) {
    reset(nextRole);
    const detail = await queries.getProduct("p1");
    assert.deepEqual(detail?.costs, costs);
    assert.equal(detail?.images.length, 3);
    assert.match(detail!.images[0].signed_url!, /p1\/0.jpg/);
    assert.match(detail!.images[2].signed_url!, /p1\/2.jpg/);
    assert.equal("public_url" in detail!.images[0], false);
    const signed = calls.filter(call => call.method === "POST");
    assert.equal(signed.length, 1);
    assert.equal((signed[0].body!.paths as string[]).length, 3);
    assert.deepEqual((await queries.listProducts()).items[0].costs, costs);
    assert.deepEqual((await queries.listProductRequests()).items[0].costs, costs);
    assert.ok(calls.some(call => call.table === "product_request_costs"));
  }
});
test("each public query authenticates before creating its client and refuses unknown roles", async () => {
  const readers = [() => queries.getInventoryOverview(), () => queries.listProducts(), () => queries.getProduct("p1"), () => queries.listCategories(), () => queries.listActiveBrands(), () => queries.listProductRequests(), () => queries.listMovementRequests(), () => queries.listMovements()];
  for (const reader of readers) {
    reset(); authError = true;
    await assert.rejects(reader, /authentication required/);
    assert.equal(clientCalls, 0);
    reset(); role = null;
    await assert.rejects(reader, /Inventory access denied/);
    assert.equal(clientCalls, 0);
  }
});
test("overview reads past API row limits and reports accurate quantities and counts", async () => {
  reset(); cap = 2;
  fixtures.products = Array.from({ length: 5 }, (_, i) => ({ ...product, id: `p${i}` }));
  const overview = await queries.getInventoryOverview();
  assert.equal(overview.product_count, 5);
  assert.equal(overview.total_live_quantity, 15);
  assert.equal(overview.location_quantities.sold, 50);
  assert.equal(overview.low_stock_count, 5);
  assert.equal(overview.pending_product_requests, 1);
  assert.equal(overview.pending_movement_requests, 1);
  assert.equal(calls.filter(c => c.table === "products").length, 3);
});
test("related rows are read in batches and RLS-hidden profile names stay null", async () => {
  reset();
  assert.equal((await queries.listCategories())[0].name, "Seating");
  assert.deepEqual(await queries.listActiveBrands(), [{ id: "b1", name: "Brand" }]);
  const requests = await queries.listMovementRequests({ request_type: "hold" });
  assert.equal(requests.items[0].product?.id, "p1");
  assert.equal(requests.items[0].submitter_display_name, null);
  assert.equal((await queries.listMovements()).items[0].actor_display_name, null);
  assert.equal(calls.some(c => c.table.includes("cost")), false);
});
test("product filters and page boundaries reach PostgREST; database failures do not become empty success", async () => {
  reset();
  await queries.listProducts({ search: "Chair", location: "warehouse", brand_id: "b1", sort: "quantity_desc" }, 2);
  const url = calls.find(c => c.table === "products")!.url;
  assert.equal(url.searchParams.get("offset"), "24");
  assert.equal(url.searchParams.get("limit"), "24");
  assert.equal(url.searchParams.get("warehouse_quantity"), "gt.0");
  assert.equal(url.searchParams.get("is_active"), "eq.true");
  assert.equal(url.searchParams.get("brand_id"), "eq.b1");
  assert.match(url.searchParams.get("order")!, /^quantity.desc,id.asc/);
  reset(); failTable = "products";
  await assert.rejects(() => queries.getInventoryOverview());
  await assert.rejects(() => queries.listProducts());
});
