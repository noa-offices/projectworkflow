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
let failPageRange = false;
const product = { id: "p1", brand_id: "b1", category_id: "c1", subcategory_id: null, item_name: "Chair", item_code: "C1", stock_ref: "S1", model_name: "M1", quantity: 3, low_stock_at: 3, warehouse_quantity: 2, dubai_showroom_quantity: 1, abudhabi_showroom_quantity: 0, mockup_quantity: 0, temporary_out_quantity: 0, sold_quantity: 10, is_active: true, price: 999, total_cost: 999, costs: { price: 999 } };
const costs = { price: 10, freight_cost: 1, c_and_f: 2, transport: 3, custom_duty: 4, labour: 5, vat: 6, total_cost: 31 };
function reset(nextRole = "viewer") {
  role = nextRole; authError = false; clientCalls = 0; calls = []; cap = 1000; failTable = null; failSigning = false; failPageRange = false;
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
    assert.equal(headers.get("Accept-Profile"), ["brands", "profiles", "clients", "projects"].includes(table) ? "public" : "inventory");
    if (failPageRange && table === "products") return Response.json({ code: "PGRST103", message: "Requested range not satisfiable" }, { status: 416 });
    if (table === failTable) return Response.json({ message: "fixture failure" }, { status: 500 });
    // The two SECURITY DEFINER name functions: id + full_name only, and only people with Inventory activity (no_activity marks the others).
    if (table === "person_names" || table === "search_people") {
      assert.equal(method, "GET");
      const people = (fixtures.profiles ?? []).filter(row => !row.no_activity);
      if (table === "person_names") {
        const wanted = (url.searchParams.get("p_ids") ?? "{}").slice(1, -1).split(",").filter(Boolean);
        assert.ok(wanted.length <= 200);
        return Response.json(people.filter(row => wanted.includes(String(row.id))).map(row => ({ id: row.id, full_name: row.full_name ?? null })));
      }
      const term = (url.searchParams.get("term") ?? "").trim().toLowerCase();
      return Response.json(term.length < 2 ? [] : people.filter(row => String(row.full_name ?? "").toLowerCase().includes(term)).map(row => ({ id: row.id })));
    }
    let rows = fixtures[table] ?? [];
    for (const [key, value] of url.searchParams) {
      if (value === "is.null") rows = rows.filter(row => row[key] == null);
      if (["brands","read_local_brand_names","list_local_brands"].includes(table) && value.startsWith("ilike.")) rows = rows.filter(row=>String(row[key] ?? "").toLowerCase().includes(value.slice(6).replaceAll("%", "").toLowerCase()));
      if (value.startsWith("eq.")) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (value.startsWith("gt.")) rows = rows.filter(row => Number(row[key]) > Number(value.slice(3)));
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

test('product movement actors use the same safe name source as Movements', async () => {
  reset('system_owner');
  fixtures.profiles = [{id:'hidden', full_name:'Junais KP', email:'never@example.com'}];
  const detail = await queries.getProduct('p1');
  const history = await queries.listMovements({product_id:'p1'});
  assert.equal(detail?.recent_movements[0].actor_display_name, 'Junais KP');
  assert.equal(detail?.recent_movements[0].actor_display_name, history.items[0].actor_display_name);
  assert.equal(calls.filter(call => call.table === 'profiles').length, 0, 'public.profiles is never read directly');
  assert.ok(callsTo('person_names').length > 0);
  assert.ok(!JSON.stringify(detail).includes('never@example.com'));
  fixtures.profiles = [];
  assert.equal((await queries.getProduct('p1'))?.recent_movements[0].actor_display_name, null);
});

test('Overview activity maps full names without costs, emails or extra profile access', async () => {
  reset('admin_manager');
  fixtures.profiles = [{id:'hidden', full_name:'Junais KP', email:'never@example.com'}];
  fixtures.products = [{...product,created_by:'hidden',created_at:'2026-10-26T04:56:00Z'}];
  const activity = await queries.getInventoryOverviewActivity();
  assert.equal(activity?.pending_products[0].display_name,'Junais KP');
  assert.equal(activity?.pending_movements[0].display_name,'Junais KP');
  assert.equal('recent_movements' in (activity ?? {}),false);
  assert.equal(calls.some(call=>call.table==='movements'),false,'the Overview no longer reads movements');
  assert.equal('recent_products' in (activity ?? {}),false);
  assert.equal(calls.some(call=>call.table==='products'&&call.url.searchParams.get('order')==='created_at.desc,id.asc'),false,'no recent-items query');
  assert.equal(activity?.pending_movements[0].stock_ref,product.stock_ref);
  assert.ok(!JSON.stringify(activity).includes('never@example.com'));
  assert.equal(calls.some(call=>call.table.includes('cost')),false);
  assert.equal(calls.filter(call=>call.table==='profiles').length,0);
  fixtures.profiles=[];
  assert.equal((await queries.getInventoryOverviewActivity())?.pending_products[0].display_name,null);
  for (const value of ['warehouse_staff','designer','viewer','sales_designer']) {
    reset(value);
    assert.equal(await queries.getInventoryOverviewActivity(),null);
    assert.equal(clientCalls,0);
  }
});

test('pending product movement requests and reservations retain their product Stock ref',async()=>{
  reset('admin_manager');
  const pending=await queries.getPendingProductMovementRequests('p1');
  assert.equal(pending[0].product?.stock_ref,product.stock_ref);
  fixtures.reservations=[{id:'r1',product_id:'p1',status:'active',quantity:1,kind:'book',created_by:'hidden',expires_at:null}];
  assert.equal((await queries.getProduct('p1'))?.reservations[0].product?.stock_ref,product.stock_ref);
});

test('type counts use three full-dataset HEAD reads and ignore the selected type', async () => {
  reset(); cap = 1;
  fixtures.products = ['product','product','accessory','temporary'].map((item_type,i) => ({...product,id:`p${i}`,item_type}));
  assert.deepEqual(await queries.getProductTypeCounts({item_type:'accessory'}), {all:4,product:2,accessory:1,temporary:1});
  assert.equal(calls.length,3);
  for (const call of calls) {
    assert.equal(call.method,'HEAD'); assert.equal(call.table,'products');
    assert.equal(call.url.searchParams.get('select'),'id');
    assert.equal(call.url.searchParams.has('limit'),false);
    assert.equal(call.url.searchParams.has('offset'),false);
    assert.equal(call.url.searchParams.get('is_active'),'eq.true');
  }
});

test('type counts share every list filter except selected item type and sort', async () => {
  reset();
  await queries.getProductTypeCounts({search:'Chair',brand_id:'b1',category_id:'c1',subcategory_id:'s1',status:'hold',location:'warehouse',active:false,item_type:'temporary',sort:'quantity_desc'});
  for (const {url} of calls.filter(call=>call.table==="products")) {
    for (const [key,value] of Object.entries({brand_id:'eq.b1',category_id:'eq.c1',subcategory_id:'eq.s1',status:'eq.hold',warehouse_quantity:'gt.0',is_active:'eq.false'})) assert.equal(url.searchParams.get(key),value);
    assert.match(url.searchParams.get('or')!,/stock_ref.ilike/);
    assert.equal(url.searchParams.has('order'),false);
  }
  reset(); await queries.getProductTypeCounts({active:'all'});
  assert.ok(calls.every(call=>!call.url.searchParams.has('is_active')));
  reset(); failTable='products';
  await assert.rejects(()=>queries.getProductTypeCounts(),/Unable to count inventory/);
});

test('request images use the signed-in client, are batched and never query costs', async () => {
  reset('warehouse_staff');
  fixtures.product_images = fixtures.product_images.map(image => ({...image, product_id:null,product_request_id:'r1'}));
  const images = await queries.getProductRequestImages('r1');
  assert.equal(images.length, 3);
  assert.equal(calls.filter(call => call.url.pathname.includes('/storage/')).length, 1);
  assert.ok(images.every(image => image.signed_url));
  assert.equal(calls.some(call => call.table.includes('costs')), false);
  assert.ok(calls.find(call => call.table === 'product_images')!.url.searchParams.get('product_request_id') === 'eq.r1');
});
test('pending product movement requests respect product/status filters and RLS names', async () => {
  reset();
  fixtures.movement_requests.push({...fixtures.movement_requests[0],id:'reviewed',request_status:'approved'});
  const result = await queries.getPendingProductMovementRequests('p1');
  assert.equal(result.length, 1);
  assert.equal(result[0].submitter_display_name, null);
  assert.equal(calls.some(call => call.table.includes('costs')), false);
});
test('approved request photos follow the approved product after photos are relinked', async () => {
  reset();
  fixtures.product_requests[0].request_status = 'approved';
  const images = await queries.getProductRequestImages('r1');
  assert.equal(images.length, 3);
  assert.equal(calls.find(call => call.table === 'product_images')!.url.searchParams.get('product_id'), 'eq.p1');
  assert.equal(calls.some(call => call.table.includes('costs')), false);
  assert.deepEqual(await queries.getProductRequestImages('missing'), []);
});

test("out-of-range product pages preserve a specific error for URL recovery", async () => {
  reset(); failPageRange = true;
  await assert.rejects(() => queries.listProducts({}, 99), { name: "InventoryPageRangeError" });
  assert.equal(calls.length, 1);
});

test("six non-manager roles never query cost tables or receive cost fields", async () => {
  for (const nextRole of ["procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer", "warehouse_staff"]) {
    reset(nextRole);
    const detail = await queries.getProduct("p1");
    const products = await queries.listProducts();
    const requests = await queries.listProductRequests();
    const movementRequests = await queries.listMovementRequests();
    await assert.rejects(() => queries.listMovements(), /Inventory access denied/);
    const movements = null;
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
  const readers = [() => queries.getInventoryOverview(), () => queries.listProducts(), () => queries.getProductTypeCounts(), () => queries.getProduct("p1"), () => queries.listCategories(), () => queries.listActiveBrands(), () => queries.listProductRequests(), () => queries.listMovementRequests(), () => queries.listMovements()];
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
  role = "system_owner";
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

test('products and overview subtract only active unexpired reservations and preserve RLS-hidden creator names', async () => {
 reset();
 fixtures.reservations = [{id:'rs1',product_id:'p1',price:999,kind:'book',quantity:2,status:'active',expires_at:null,created_by:'hidden',project_label:'PR-1 · Office · Client',created_at:'2026-10-24T00:00:00Z'}, {id:'rs2',product_id:'p1',kind:'hold',quantity:1,status:'active',expires_at:'2020-01-01T00:00:00Z',created_by:'hidden'}];
 const detail = await queries.getProduct('p1');
 assert.equal(detail?.reserved_quantity,2);
 assert.equal(detail?.available_quantity,1);
 assert.equal(detail?.reservations.length,1);
 assert.equal(detail?.reservations[0].creator_display_name,null);
 assert.equal('price' in detail!.reservations[0],false);
 assert.equal((await queries.listProducts()).items[0].available_quantity,1);
 assert.equal((await queries.getInventoryOverview()).reserved_quantity,2);
});
test('project picker uses signed-in RLS reads, real search columns, safe filters, and at most twenty display labels', async () => {
 reset('designer');
 fixtures.clients = [{id:'client1',company_name:'Acme'}];
 fixtures.projects = Array.from({length:25},(_,i)=>({id:`project${i}`,project_number:`2026-${i}`,project_code:`PR-${i}`,project_name:'Office',client_id:'client1',clients:{company_name:'Acme'}}));
 const result = await queries.listProjectsForInventory('Office,(test)%');
 assert.equal(result.length,20);
 assert.deepEqual(Object.keys(result[0]).sort(),['id','label']);
 assert.match(result[0].label,/2026-0.*Office.*Acme/);
 const projectCall = calls.find(call => call.table === 'projects')!;
 assert.equal(projectCall.schema,'public');
 assert.match(projectCall.url.searchParams.get('or')!,/project_number.ilike/);
 assert.match(projectCall.url.searchParams.get('or')!,/project_code.ilike/);
 assert.match(projectCall.url.searchParams.get('or')!,/project_name.ilike/);
 assert.equal(projectCall.url.searchParams.get('limit'),'20');
 reset('warehouse_staff');
 await assert.rejects(()=>queries.listProjectsForInventory('Office'),/access denied/);
 assert.equal(clientCalls,0);
});


test('reservation read failures never turn into available stock', async () => {
 reset(); failTable = 'reservations';
 await assert.rejects(()=>queries.listProducts(),/Unable to read inventory/);
 await assert.rejects(()=>queries.getProduct('p1'),/Unable to read inventory/);
 await assert.rejects(()=>queries.getInventoryOverview(),/Unable to read inventory/);
});
test('generated stock refs remain searchable and nullable request and product identifiers survive reads',async()=>{
  reset();
  fixtures.products=[{...product,item_code:null,model_name:null,stock_ref:'02-0001'}];
  fixtures.product_requests=[{...fixtures.product_requests[0],stock_ref:null,item_code:null,model_name:null}];
  const result=await queries.listProducts({search:'02-0001'});
  assert.equal(result.items[0].stock_ref,'02-0001');assert.equal(result.items[0].item_code,null);assert.equal(result.items[0].model_name,null);
  const query=calls.find(call=>call.table==='products')!;
  assert.match(query.url.searchParams.get('or')!,/stock_ref\.ilike/);
  assert.match(query.url.searchParams.get('or')!,/02-0001/);
  const detail=await queries.getProduct('p1');
  assert.equal(detail?.stock_ref,'02-0001');assert.equal(detail?.item_code,null);assert.equal(detail?.model_name,null);
  const requests=await queries.listProductRequests();
  assert.equal(requests.items[0].stock_ref,null);assert.equal(requests.items[0].item_code,null);assert.equal(requests.items[0].model_name,null);
});

test("every Overview card opens a Products list with the same number of products", async () => {
  reset();
  const stock = { warehouse_quantity: 0, dubai_showroom_quantity: 0, abudhabi_showroom_quantity: 0, mockup_quantity: 0, temporary_out_quantity: 0, sold_quantity: 0, quantity: 0, low_stock_at: 2, item_type: "product", is_active: true };
  fixtures.products = [
    { ...product, ...stock, id: "a", item_type: "product", warehouse_quantity: 5, dubai_showroom_quantity: 2, quantity: 7, sold_quantity: 4 },
    { ...product, ...stock, id: "b", item_type: "accessory", warehouse_quantity: 1, quantity: 1 },
    { ...product, ...stock, id: "c", item_type: "temporary", mockup_quantity: 3, quantity: 3, sold_quantity: 1 },
    { ...product, ...stock, id: "d", item_type: "product", quantity: 0, sold_quantity: 9 },
    { ...product, ...stock, id: "e", item_type: "accessory", abudhabi_showroom_quantity: 4, quantity: 4 },
    { ...product, ...stock, id: "x", is_active: false, warehouse_quantity: 9, quantity: 9 },
  ];
  const future = "2999-01-01T00:00:00Z", past = "2000-01-01T00:00:00Z";
  fixtures.reservations = [
    { id: "r1", product_id: "a", quantity: 2, status: "active", expires_at: null },
    { id: "r2", product_id: "a", quantity: 1, status: "active", expires_at: future },
    { id: "r3", product_id: "b", quantity: 1, status: "active", expires_at: past },
    { id: "r4", product_id: "c", quantity: 1, status: "released", expires_at: null },
    { id: "r5", product_id: "e", quantity: 1, status: "active", expires_at: future },
  ];
  const overview = await queries.getInventoryOverview();
  const cards: [string, number, Record<string, string>][] = [
    ["units/products", overview.product_count, { stock: "live" }],
    ["accessories", overview.item_type_counts.accessory, { item_type: "accessory", stock: "live" }],
    ["temporary", overview.item_type_counts.temporary, { item_type: "temporary", stock: "live" }],
    ["reserved", overview.reserved_product_count, { stock: "reserved" }],
    ...(["warehouse", "dubai_showroom", "abudhabi_showroom", "mockup", "temporary_out", "sold"] as const).map(location => [location, overview.location_product_counts[location], { location }] as [string, number, Record<string, string>]),
  ];
  assert.deepEqual([overview.product_count, overview.reserved_quantity, overview.reserved_product_count], [4, 3 + 1, 2]);
  for (const [name, count, filters] of cards) {
    const list = await queries.listProducts(filters as never, 1);
    assert.equal(list.total, count, name);
    assert.equal(list.items.length, count, name);
  }
  assert.deepEqual(await queries.getProductTypeCounts({ stock: "live" }), { all: 4, product: 1, accessory: 2, temporary: 1 });
  assert.equal((await queries.listProducts({ stock: "reserved", item_type: "accessory" })).total, 1);
  await assert.rejects(() => queries.listProducts({ stock: "bogus" } as never));
});

const callsTo = (table: string) => calls.filter(call => call.table === table);
test("movement history builds every filter, links requests, and is for managers only", async () => {
  for (const viewerRole of ["viewer", "warehouse_staff", "procurement_manager"]) {
    reset(viewerRole);
    await assert.rejects(() => queries.listMovements(), /Inventory access denied/);
    assert.equal(clientCalls, 0);
  }
  reset("admin_manager");
  fixtures.profiles = [{ id: "u1", full_name: "Alex" }];
  fixtures.movements = [{ id: "m1", product_id: "p1", action_type: "sale", movement_type: "stock_out", from_location: "warehouse", to_location: "sold", quantity: 2, previous_quantity: 5, new_quantity: 3, created_by: "u1", created_at: "2026-10-23T00:00:00Z", reference_type: "manual", reference_id: null }];
  fixtures.movement_requests = [{ id: "mr1", approved_movement_id: "m1" }];
  const page = await queries.listMovements({ product_id: "p1", action_type: "sale", location: "warehouse", search: "chair", person: "alex", from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T23:59:59.999Z" });
  const params = callsTo("movements")[0].url.searchParams;
  assert.deepEqual(params.getAll("product_id").sort(), ["eq.p1", "in.(p1)"]);
  assert.equal(params.get("action_type"), "eq.sale"); assert.equal(params.get("created_by"), "in.(u1)");
  assert.equal(params.get("or"), "(from_location.eq.warehouse,to_location.eq.warehouse)");
  assert.deepEqual(params.getAll("created_at").sort(), ["gte.2026-10-01T00:00:00.000Z", "lte.2026-10-31T23:59:59.999Z"]);
  assert.equal(params.get("order"), "created_at.desc,id.asc");
  assert.equal(page.items[0].linked?.kind, "request");
  assert.equal(page.items[0].actor_display_name, "Alex");
  assert.equal(calls.some(call => call.table.includes("cost")), false);
});
test("movement history returns nothing, without reading movements, when search or person matches nobody", async () => {
  reset("system_owner"); fixtures.profiles = [];
  const none = await queries.listMovements({ person: "nobody" });
  assert.equal(none.total, 0); assert.equal(callsTo("movements").length, 0);
  reset("system_owner"); fixtures.products = [];
  assert.equal((await queries.listMovements({ search: "ghost" })).total, 0); assert.equal(callsTo("movements").length, 0);
});
test("request search covers product fields for everyone and submitter names for managers only", async () => {
  reset("system_owner"); fixtures.profiles = [{ id: "u1", full_name: "Chair Person" }];
  await queries.listMovementRequests({ search: "chair" });
  let or = callsTo("movement_requests")[0].url.searchParams.get("or")!;
  assert.match(or, /product_id\.in\.\(p1\)/); assert.match(or, /submitted_by\.in\.\(u1\)/);
  reset("system_owner"); fixtures.profiles = [{ id: "u1", full_name: "Chair Person" }];
  await queries.listProductRequests({ search: "chair" });
  or = callsTo("product_requests")[0].url.searchParams.get("or")!;
  assert.match(or, /item_name\.ilike\./); assert.match(or, /submitted_by\.in\.\(u1\)/);
  reset("warehouse_staff"); fixtures.profiles = [{ id: "u1", full_name: "Chair Person" }];
  await queries.listMovementRequests({ search: "chair" });
  or = callsTo("movement_requests")[0].url.searchParams.get("or")!;
  assert.match(or, /product_id\.in\.\(p1\)/); assert.doesNotMatch(or, /submitted_by/);
  assert.equal(callsTo("search_people").length, 0);
  reset("warehouse_staff");
  await queries.listProductRequests({ search: "chair" });
  assert.doesNotMatch(callsTo("product_requests")[0].url.searchParams.get("or")!, /submitted_by/);
  reset("system_owner"); fixtures.products = [];
  assert.equal((await queries.listMovementRequests({ search: "ghost" })).total, 0); assert.equal(callsTo("movement_requests").length, 0);
});
test("category overview counts active products per category and is for managers only", async () => {
  reset("viewer");
  await assert.rejects(() => queries.listCategoryOverview(), /Inventory access denied/);
  reset("admin_manager");
  fixtures.categories = [{ id: "c1", name: "Seating", parent_id: null, sort_order: 0 }, { id: "c2", name: "Task", parent_id: "c1", sort_order: 0 }];
  fixtures.products = [{ ...product, id: "a", category_id: "c1", subcategory_id: "c2" }, { ...product, id: "b", category_id: "c1", subcategory_id: null }];
  const tree = await queries.listCategoryOverview();
  assert.deepEqual([tree[0].item_count, tree[0].children[0].item_count], [2, 1]);
});

test("current inventory report pages through every row, applies filters, reads no costs and counts only active reservations", async () => {
  reset("admin_manager"); cap = 2;
  const base = { ...product, is_active: true, item_type: "product", status: "available", condition: "new", sold_quantity: 1 };
  fixtures.products = [
    { ...base, id: "a", item_name: "A", quantity: 5, warehouse_quantity: 5 }, { ...base, id: "b", item_name: "B", quantity: 3, warehouse_quantity: 3 },
    { ...base, id: "c", item_name: "C", quantity: 4, warehouse_quantity: 4 }, { ...base, id: "d", item_name: "D", quantity: 1, warehouse_quantity: 1 }, { ...base, id: "e", item_name: "E", quantity: 2, warehouse_quantity: 2 },
  ];
  fixtures.reservations = [
    { id: "r1", product_id: "a", quantity: 2, status: "active", expires_at: null }, { id: "r2", product_id: "a", quantity: 1, status: "active", expires_at: "2000-01-01T00:00:00Z" },
    { id: "r3", product_id: "b", quantity: 1, status: "active", expires_at: "2999-01-01T00:00:00Z" },
  ];
  const report = await queries.listCurrentInventoryReport({ brand: "", category: "", itemType: "", location: "warehouse", status: "", includeSoldOut: false, photos: false, excelPhotos: false });
  assert.equal(report.rows.length, 5);
  assert.deepEqual(report.rows.map(item => [item.item_name, item.total_live, item.reserved, item.available]), [["A", 5, 2, 3], ["B", 3, 1, 2], ["C", 4, 0, 4], ["D", 1, 0, 1], ["E", 2, 0, 2]]);
  const productCalls = callsTo("products");
  assert.ok(productCalls.length >= 3); // 5 rows, 2 per response
  for (const call of productCalls) {
    assert.equal(call.url.searchParams.get("is_active"), "eq.true"); assert.equal(call.url.searchParams.get("warehouse_quantity"), "gt.0"); assert.equal(call.url.searchParams.get("quantity"), "gt.0");
    assert.doesNotMatch(call.url.searchParams.get("select") ?? "", /cost|price|vat|labour|freight/);
  }
  assert.equal(calls.some(call => call.table.includes("cost")), false);
  reset("system_owner"); fixtures.products = [{ ...base, id: "z", item_name: "Z", quantity: 0 }];
  const withSoldOut = await queries.listCurrentInventoryReport({ brand: "b1", category: "c1", itemType: "accessory", location: "", status: "hold", includeSoldOut: true, photos: false, excelPhotos: false });
  const params = callsTo("products")[0].url.searchParams;
  assert.equal(params.get("brand_id"), "eq.b1"); assert.equal(params.get("category_id"), "eq.c1"); assert.equal(params.get("item_type"), "eq.accessory"); assert.equal(params.get("status"), "eq.hold"); assert.equal(params.has("quantity"), false);
  assert.equal(withSoldOut.brandName, "Brand");
  for (const viewerRole of ["viewer", "warehouse_staff", "designer"]) { reset(viewerRole); await assert.rejects(() => queries.listCurrentInventoryReport({ brand: "", category: "", itemType: "", location: "", status: "", includeSoldOut: false, photos: false, excelPhotos: false }), /Inventory access denied/); assert.equal(clientCalls, 0); }
});
test("movements report pages through all rows and refuses more than the limit", async () => {
  reset("admin_manager"); cap = 1;
  fixtures.movements = [1, 2, 3].map(index => ({ id: `m${index}`, product_id: "p1", action_type: "sale", movement_type: "stock_out", from_location: "warehouse", to_location: "sold", quantity: 1, previous_quantity: 5, new_quantity: 4, created_by: "u1", created_at: `2026-10-2${index}T00:00:00Z`, reference_type: "manual", reference_id: null }));
  const all = await queries.listMovementsForReport({ from: "2026-10-01T00:00:00.000Z" }, 10);
  assert.equal(all.movements.length, 3);
  assert.ok(callsTo("movements").filter(call => call.method === "GET").length >= 3);
  assert.equal(callsTo("movements")[0].method, "HEAD");
  await assert.rejects(() => queries.listMovementsForReport({}, 2), (error: Error) => error.name === "ReportTooLargeError" && /Narrow the date range/.test(error.message));
  for (const viewerRole of ["viewer", "warehouse_staff", "procurement_manager"]) { reset(viewerRole); await assert.rejects(() => queries.listMovementsForReport({}, 10), /Inventory access denied/); assert.equal(clientCalls, 0); }
});

test('local and no-brand identities resolve labels, filters and movement summaries',async()=>{
 reset('admin_manager');
 fixtures.products=[{...product,brand_id:null,local_brand_id:'shop'}];
 fixtures.read_local_brand_names=[{id:'shop',name:'Shop',code:'SHP'}];
 fixtures.list_local_brands=fixtures.read_local_brand_names;
 const listed=await queries.listProducts({brand_id:'local:shop'});
 assert.equal(listed.items[0].brand_name,'Shop');
 assert.equal(calls.find(c=>c.table==='products')!.url.searchParams.get('local_brand_id'),'eq.shop');
 assert.equal((await queries.listActiveBrands()).find(row=>row.id==='shop')?.kind,'local');
 assert.equal((await queries.listMovements()).items[0].product?.brand_name,'Shop');
 fixtures.products=[{...product,brand_id:null,local_brand_id:null}]; calls=[];
 assert.equal((await queries.listProducts({brand_id:'none'})).items[0].brand_name,null);
 const url=calls.find(c=>c.table==='products')!.url;
 assert.equal(url.searchParams.get('brand_id'),'is.null');assert.equal(url.searchParams.get('local_brand_id'),'is.null');
});
test('brand names join the search across products, requests and movement lookups',async()=>{
 reset('admin_manager'); fixtures.read_local_brand_names=[{id:'shop',name:'Shop'}];
 await queries.listProducts({search:'Shop'});
 assert.match(calls.find(c=>c.table==='products')!.url.searchParams.get('or')!,/local_brand_id.in.\(shop\)/);
 calls=[]; await queries.listProductRequests({search:'Shop'});
 assert.match(calls.find(c=>c.table==='product_requests')!.url.searchParams.get('or')!,/local_brand_id.in.\(shop\)/);
 calls=[];await queries.listMovements({search:'Shop'});
 assert.match(calls.find(c=>c.table==='products')!.url.searchParams.get('or')!,/local_brand_id.in.\(shop\)/);
});

test('historical local names paginate within chunks for large reports',async()=>{
 reset('admin_manager'); cap=1;
 fixtures.products=Array.from({length:155},(_,index)=>({...product,id:`p${index}`,brand_id:null,local_brand_id:`shop${index}`}));
 fixtures.read_local_brand_names=fixtures.products.map((row,index)=>({id:row.local_brand_id,name:`Shop ${index}`}));
 const filters={brand:'',category:'',itemType:'' as const,location:'' as const,status:'' as const,includeSoldOut:true,photos:false,excelPhotos:false};
 const result=await queries.listCurrentInventoryReport(filters);
 assert.equal(result.rows.length,155);assert.ok(result.rows.every((row,index)=>row.brand===`Shop ${index}`));
 assert.ok(calls.filter(call=>call.table==='read_local_brand_names').every(call=>(call.url.searchParams.get('id')?.split(',').length ?? 0)<=150));
});
test('brand search keeps visible punctuation in names',async()=>{
 reset();fixtures.read_local_brand_names=[{id:'shop',name:'Acme (UAE)'}];
 await queries.listProducts({search:'Acme (UAE)'});
 const call=calls.find(row=>row.table==='read_local_brand_names')!;
 assert.equal(call.url.searchParams.get('name'),'ilike.%Acme (UAE)%');
 assert.match(calls.find(row=>row.table==='products')!.url.searchParams.get('or')!,/local_brand_id.in.\(shop\)/);
 for(const read of [()=>queries.listMovementRequests({search:'Acme (UAE)'}),()=>queries.listMovements({search:'Acme (UAE)'}),()=>queries.listMovementsForReport({search:'Acme (UAE)'},100)]) {
  reset('admin_manager');fixtures.read_local_brand_names=[{id:'shop',name:'Acme (UAE)'}];await read();
  assert.equal(calls.find(row=>row.table==='read_local_brand_names')!.url.searchParams.get('name'),'ilike.%Acme (UAE)%');
 }
});

test('approved requests supply the requester for items and movements through the existing read path', async () => {
  reset('admin_manager');
  fixtures.profiles = [{id:'worker', full_name:'Subair'},{id:'boss', full_name:'Junais KP'}];
  fixtures.products = [{...product,created_by:'boss',created_at:'2026-10-26T04:56:00Z'}];
  fixtures.product_requests = [{...product,id:'r1',submitted_by:'worker',reviewed_by:'boss',approved_product_id:'p1',request_status:'approved'}];
  fixtures.movements = [{id:'m1',product_id:'p1',created_by:'boss',created_at:'2026-10-23T00:00:00Z',reference_type:'manual',reference_id:null},{id:'m2',product_id:'p1',created_by:'boss',created_at:'2026-10-22T00:00:00Z',reference_type:'product_request',reference_id:'r1'},{id:'m3',product_id:'p1',created_by:'boss',created_at:'2026-10-21T00:00:00Z',reference_type:'manual',reference_id:null}];
  fixtures.movement_requests = [{id:'mr1',product_id:'p1',submitted_by:'worker',reviewed_by:'boss',approved_movement_id:'m1',request_status:'approved'},{id:'mr2',product_id:'p1',submitted_by:'boss',reviewed_by:'boss',approved_movement_id:'m3',request_status:'approved'}];
  const activity = await queries.getInventoryOverviewActivity();
  assert.equal(calls.some(call=>call.table.includes('cost')),false,'Overview reads no costs');
  const detail = await queries.getProduct('p1');
  const byId = Object.fromEntries(detail!.recent_movements.map(row => [row.id,row.attribution]));
  assert.equal(byId.m1?.request?.requester_name,'Subair');   // movement request
  assert.equal(byId.m2?.request?.requester_name,'Subair');   // item added by a product request
  assert.equal(byId.m3?.request?.requester_id,'boss');       // requester is the approver
  assert.ok(!JSON.stringify([activity,detail]).includes('never@example.com'));
  assert.equal(calls.filter(call=>call.table==='profiles').length,0);
});

test('a manager adding directly has no request, so the creator is shown alone', async () => {
  reset('admin_manager');
  fixtures.profiles = [{id:'boss', full_name:'Junais KP'}];
  fixtures.products = [{...product,created_by:'boss',created_at:'2026-10-26T04:56:00Z'}];
  fixtures.product_requests = [];
  fixtures.movements = [{id:'m1',product_id:'p1',created_by:'boss',created_at:'2026-10-23T00:00:00Z',reference_type:'manual',reference_id:null}];
  fixtures.movement_requests = [];
  const detail = await queries.getProduct('p1');
  assert.equal(detail?.recent_movements[0].attribution?.request,null);
  assert.equal(detail?.recent_movements[0].attribution?.creator_name,'Junais KP');
});

test('every Inventory role gets names through person_names, never from public.profiles', async () => {
  for (const nextRole of ["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer", "warehouse_staff"]) {
    reset(nextRole);
    fixtures.profiles = [{ id: "hidden", full_name: "Junais KP", email: "never@example.com" }];
    const detail = await queries.getProduct("p1");
    assert.equal(detail?.recent_movements[0].actor_display_name, "Junais KP", nextRole);
    assert.equal(calls.filter(call => call.table === "profiles").length, 0, nextRole);
    assert.ok(!JSON.stringify(detail).includes("never@example.com"), nextRole);
  }
});

test('names fall back to null only for people the function does not return or who have no name', async () => {
  reset("viewer");
  fixtures.profiles = [{ id: "hidden", full_name: null }];
  assert.equal((await queries.getProduct("p1"))?.recent_movements[0].actor_display_name, null);
  fixtures.profiles = [{ id: "hidden", full_name: "Junais KP", no_activity: true }];
  assert.equal((await queries.getProduct("p1"))?.recent_movements[0].actor_display_name, null);
});

test('person search works for a non-owner manager through search_people with the raw term', async () => {
  reset("admin_manager");
  fixtures.profiles = [{ id: "u1", full_name: "Subair Worker" }, { id: "u2", full_name: "Hidden Nobody", no_activity: true }];
  fixtures.movements = [{ id: "m1", product_id: "p1", created_by: "u1", created_at: "2026-10-23T00:00:00Z" }];
  const page = await queries.listMovements({ person: "subair" });
  assert.equal(callsTo("search_people")[0].url.searchParams.get("term"), "subair");
  assert.equal(callsTo("movements")[0].url.searchParams.get("created_by"), "in.(u1)");
  assert.equal(page.items.length, 1);
  assert.equal(calls.filter(call => call.table === "profiles").length, 0);
  reset("admin_manager");
  fixtures.profiles = [{ id: "u2", full_name: "Hidden Nobody", no_activity: true }];
  assert.equal((await queries.listMovements({ person: "hidden" })).total, 0);
});

test('a name lookup failure is an error, not a silent Team member', async () => {
  reset("viewer"); fixtures.profiles = [{ id: "hidden", full_name: "Junais KP" }]; failTable = "person_names";
  await assert.rejects(() => queries.getProduct("p1"), /Unable to read inventory data/);
});

test('the New items filter returns only the stock-in movements made when an item was created', async () => {
  reset('admin_manager');
  fixtures.movements = [
    { id: 'm1', product_id: 'p1', action_type: 'receive_stock', reference_type: 'product_request', reference_id: 'r1', created_by: 'u1', created_at: '2026-10-25T00:00:00Z' },
    { id: 'm2', product_id: 'p1', action_type: 'receive_stock', reference_type: 'manual', reference_id: null, created_by: 'u1', created_at: '2026-10-24T00:00:00Z' },
    { id: 'm3', product_id: 'p1', action_type: 'sale', reference_type: 'manual', reference_id: null, created_by: 'u1', created_at: '2026-10-23T00:00:00Z' },
    { id: 'm5', product_id: 'p1', action_type: 'receive_stock', reference_type: 'product_request', reference_id: 'r2', created_by: 'u1', created_at: '2026-10-21T00:00:00Z' },
  ];
  const news = await queries.listMovements({ new_items: true });
  assert.deepEqual(news.items.map(row => row.id), ['m1', 'm5']);
  const params = callsTo('movements')[0].url.searchParams;
  assert.equal(params.get('reference_type'), 'eq.product_request');
  assert.deepEqual(params.getAll('action_type'), ['eq.receive_stock']);
  // Works together with search, location, dates and the page offset.
  reset('admin_manager');
  fixtures.movements = [{ id: 'm1', product_id: 'p1', action_type: 'receive_stock', reference_type: 'product_request', reference_id: 'r1', created_by: 'u1', created_at: '2026-10-25T00:00:00Z' }];
  const combined = await queries.listMovements({ new_items: true, search: 'chair', location: 'warehouse', from: '2026-10-01T00:00:00.000Z' }, 2);
  const combinedParams = callsTo('movements')[0].url.searchParams;
  assert.equal(combinedParams.get('reference_type'), 'eq.product_request');
  assert.equal(combinedParams.get('product_id'), 'in.(p1)');
  assert.equal(combinedParams.get('or'), '(from_location.eq.warehouse,to_location.eq.warehouse)');
  assert.ok(Number(combinedParams.get('offset')) > 0 && combined.page === 2);
  // Another action filter cannot widen it: a sale is never a new-item movement.
  reset('admin_manager');
  fixtures.movements = [{ id: 'm3', product_id: 'p1', action_type: 'sale', reference_type: 'manual', reference_id: null, created_by: 'u1', created_at: '2026-10-23T00:00:00Z' }];
  assert.equal((await queries.listMovements({ new_items: true, action_type: 'sale' })).total, 0);
});
