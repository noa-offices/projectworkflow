// Golden tests for the read-only NOA Inventory capability. Fake Supabase client only: no live calls.
import assert from "node:assert/strict";
import test, { mock } from "node:test";

mock.module("server-only", { defaultExport: {} });

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const selects: { table: string; columns: string }[] = [];
const touched: string[] = [];
let role: string | null = "admin_manager";
let redirectOnAuth = false;

const applyFilters = (rows: Row[], filters: ((row: Row) => boolean)[]) => rows.filter(row => filters.every(f => f(row)));
function builder(table: string) {
  const filters: ((row: Row) => boolean)[] = [];
  const state = { head: false, from: 0, to: Number.POSITIVE_INFINITY };
  const b: Record<string, unknown> = {
    select: (columns: string, options?: { head?: boolean }) => { selects.push({ table, columns }); state.head = !!options?.head; return b; },
    eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return b; },
    gt: (column: string, value: number) => { filters.push(row => (row[column] as number) > value); return b; },
    in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return b; },
    or: () => b, ilike: () => b, order: () => b, limit: () => b, returns: () => b,
    range: (from: number, to: number) => { state.from = from; state.to = to; return b; },
    then: (resolve: (value: unknown) => void) => {
      const matched = applyFilters(tables[table] ?? [], filters);
      resolve({ error: null, count: matched.length, data: state.head ? null : matched.slice(state.from, state.to + 1) });
    },
  };
  return b;
}
const client = {
  schema: (schema: string) => ({
    from: (table: string) => { touched.push(`${schema}.${table}`); return builder(`${schema}.${table}`); },
    rpc: (name: string) => { touched.push(`${schema}.rpc.${name}`); return builder(`rpc.${name}`); },
  }),
  from: (table: string) => { touched.push(`public.${table}`); return builder(`public.${table}`); },
};
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => client } });
mock.module("@/lib/auth", { namedExports: { requireInventoryUser: async () => {
  if (redirectOnAuth) throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
  return { user: { id: "u-1" }, profile: { role } };
} } });

const { fetchNoaInventoryCapability } = await import("./noa-inventory-capability.server");
const context = { pathname: "/", section: "other" } as const;
const FORBIDDEN = /price|cost|freight|vat|labour|duty|transport|note|description|removal|created_by|updated_by|removed_by|image|photo|reserved_by|submitted/i;

const product = (n: number, extra: Row = {}): Row => ({
  id: `p-${String(n).padStart(3, "0")}`, item_name: `Item ${String(n).padStart(3, "0")}`, model_name: `M${n}`, stock_ref: `01-${n}`, item_code: `C${n}`,
  item_type: "product", status: "available", condition: "new", is_active: true, location: "Rack A", brand_id: "b-1", local_brand_id: null, category_id: "c-1", subcategory_id: null,
  warehouse_quantity: 5, dubai_showroom_quantity: 2, abudhabi_showroom_quantity: 1, mockup_quantity: 0, temporary_out_quantity: 0, sold_quantity: 7, quantity: 8, low_stock_at: 3,
  note: "SECRET NOTE", description: "SECRET DESC", removal_reason: "x", created_by: "user-1", updated_by: "user-2", ...extra,
});
function reset(rows: Row[] = [product(1)]) {
  for (const key of Object.keys(tables)) delete tables[key];
  selects.length = 0; touched.length = 0; role = "admin_manager"; redirectOnAuth = false;
  tables["inventory.products"] = rows;
  tables["public.brands"] = [{ id: "b-1", name: "Acme" }];
  tables["inventory.categories"] = [{ id: "c-1", parent_id: null, name: "Chair" }, { id: "c-2", parent_id: "c-1", name: "Task Chair" }];
  tables["rpc.read_local_brand_names"] = [];
  tables["inventory.reservations"] = [];
}
type Ok = { ok: true; data: Record<string, any>; sources: unknown[] };
const run = (options: Parameters<typeof fetchNoaInventoryCapability>[0]) => fetchNoaInventoryCapability(options, context);
const assertNoLeak = (result: unknown) => {
  assert.doesNotMatch(JSON.stringify(result), FORBIDDEN, "result must not contain cost, note or owner fields");
  for (const { table, columns } of selects) if (table === "inventory.products") assert.doesNotMatch(columns, FORBIDDEN, "select list must not name cost or note columns");
  assert.ok(!touched.some(name => /costs/.test(name)), "cost tables are never referenced");
};

test("list returns safe item fields with separate buckets and available = quantity - reserved", async () => {
  reset([product(1)]);
  tables["inventory.reservations"] = [
    { product_id: "p-001", quantity: 2, status: "active", expires_at: null, created_by: "owner-1" },
    { product_id: "p-001", quantity: 1, status: "active", expires_at: "2000-01-01T00:00:00Z" }, // expired
    { product_id: "p-001", quantity: 4, status: "released", expires_at: null },
  ];
  const result = await run({ report: "list" }) as Ok;
  assert.equal(result.ok, true);
  assert.equal(result.data.report, "list");
  assert.equal(result.data.total, 1);
  const item = result.data.items[0];
  assert.deepEqual(item.buckets, { warehouse: 5, dubaiShowroom: 2, abudhabiShowroom: 1, mockup: 0, temporaryOut: 0 });
  assert.equal(item.sold, 7); assert.equal(item.quantity, 8); assert.equal(item.reserved, 2); assert.equal(item.available, 6);
  assert.equal(item.brand, "Acme"); assert.equal(item.category, "Chair"); assert.equal(item.lowStockAt, 3);
  assertNoLeak(result);
});

test("available never goes below zero", async () => {
  reset([product(1, { quantity: 1, warehouse_quantity: 1, dubai_showroom_quantity: 0, abudhabi_showroom_quantity: 0 })]);
  tables["inventory.reservations"] = [{ product_id: "p-001", quantity: 3, status: "active", expires_at: null }];
  const item = ((await run({ report: "list" })) as Ok).data.items[0];
  assert.equal(item.available, 0);
});

test("count uses an exact head count of item records", async () => {
  reset([product(1), product(2), product(3, { is_active: false })]);
  const result = await run({ report: "count" }) as Ok;
  assert.equal(result.data.count, 2);
  assert.equal(result.data.items, undefined);
  assert.ok(selects.some(s => s.table === "inventory.products"));
  assertNoLeak(result);
});

test("item_stock returns one item, not found, or asks which one when several match", async () => {
  reset([product(1)]);
  const one = await run({ report: "item_stock", term: "Item 001" }) as Ok;
  assert.equal(one.data.report, "item_stock"); assert.equal(one.data.items.length, 1); assert.equal(one.data.needsChoice, undefined);
  assertNoLeak(one);

  reset([]);
  const none = await run({ report: "item_stock", term: "ghost" });
  assert.equal(none.ok, false); assert.equal((none as { reason: string }).reason, "not_found");

  reset(Array.from({ length: 8 }, (_, i) => product(i + 1)));
  const many = await run({ report: "item_stock", term: "Item" }) as Ok;
  assert.equal(many.data.needsChoice, true); assert.equal(many.data.total, 8); assert.equal(many.data.items.length, 5);
  assert.match(many.data.message, /which one/i);
  assertNoLeak(many);

  reset();
  const missing = await run({ report: "item_stock" });
  assert.equal(missing.ok, false);
});

test("low_stock uses quantity <= low_stock_at over all rows, not only the 20 shown", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => product(i + 1, i < 25 ? { quantity: 2, low_stock_at: 3 } : { quantity: 9, low_stock_at: 3 }));
  reset(rows);
  const result = await run({ report: "low_stock" }) as Ok;
  assert.equal(result.data.total, 25);
  assert.equal(result.data.items.length, 20);
  assert.match(result.data.truncation, /Showing the first 20 of 25\./);
  assert.ok(result.data.items.every((item: { quantity: number; lowStockAt: number }) => item.quantity <= item.lowStockAt));
  assertNoLeak(result);
});

test("by_location lists only items with stock in that live location; by_category matches real category names", async () => {
  reset([product(1, { mockup_quantity: 4, quantity: 12 }), product(2), product(3, { category_id: "c-2" })]);
  const byLocation = await run({ report: "by_location", location: "mockup" }) as Ok;
  assert.equal(byLocation.data.total, 1); assert.equal(byLocation.data.items[0].name, "Item 001");
  assert.equal((await run({ report: "by_location" })).ok, false, "location is required");
  assert.equal((await run({ report: "by_location", location: "sold" as never })).ok, false, "sold is not a live location");
  assertNoLeak(byLocation);

  const byCategory = await run({ report: "by_category", category: "chair" }) as Ok;
  assert.equal(byCategory.data.total, 3, "a parent category includes its subcategories");
  const unknown = await run({ report: "by_category", category: "spaceship" });
  assert.equal(unknown.ok, false); assert.equal((unknown as { reason: string }).reason, "not_found");
  assert.equal((await run({ report: "by_category" })).ok, false, "category is required");
});

test("lists show at most 20 items with the exact total and the cut-off message", async () => {
  reset(Array.from({ length: 27 }, (_, i) => product(i + 1)));
  const result = await run({ report: "list" }) as Ok;
  assert.equal(result.data.total, 27); assert.equal(result.data.items.length, 20); assert.equal(result.data.truncated, true);
  assert.equal(result.data.truncation, "Showing the first 20 of 27. Narrow by brand, category or location.");
  reset(Array.from({ length: 3 }, (_, i) => product(i + 1)));
  const small = await run({ report: "list" }) as Ok;
  assert.equal(small.data.truncated, false); assert.equal(small.data.truncation, undefined);
});

test("warehouse_staff and unknown roles are refused; viewer gets stock without cost fields", async () => {
  reset(); role = "warehouse_staff";
  const staff = await run({ report: "list" });
  assert.equal(staff.ok, false); assert.equal((staff as { reason: string }).reason, "unauthorized");
  assert.equal(selects.length, 0, "no query runs for a refused role");
  role = "nobody"; assert.equal((await run({ report: "list" })).ok, false);
  reset(); redirectOnAuth = true;
  assert.equal((await run({ report: "list" }) as { reason: string }).reason, "unauthorized");
  for (const viewerRole of ["viewer", "sales_designer", "procurement_manager"]) {
    reset(); role = viewerRole;
    const result = await run({ report: "list" }) as Ok;
    assert.equal(result.ok, true); assert.equal(result.data.items.length, 1);
    assertNoLeak(result);
  }
});

test("wildcards, over-long terms and unknown reports are refused before any query", async () => {
  reset();
  for (const term of ["100%", "a_b", "x\\y", "a,b", "(x)", "a*b", 'say "hi"', "x".repeat(81), "  "]) {
    const result = await run({ report: "list", term });
    assert.equal(result.ok, false, `term ${JSON.stringify(term)} must be refused`);
  }
  assert.equal((await run({ report: "list", category: "x".repeat(81) })).ok, false);
  assert.equal((await run({ report: "cost" as never })).ok, false);
  assert.equal((await run({ report: "list", location: "mars" as never })).ok, false);
  assert.equal(selects.length, 0);
  reset();
  assert.equal((await run({ report: "list", term: "x".repeat(80) })).ok, true, "80 characters is allowed");
});

test("the cost tables are never referenced for any report or role", async () => {
  for (const report of ["list", "count", "item_stock", "low_stock", "by_location", "by_category"] as const) {
    reset(); role = "system_owner";
    await run({ report, term: "Item", location: "warehouse", category: "Chair" });
    assert.ok(!touched.some(name => /costs/.test(name)), `${report} touched ${touched.join(",")}`);
    assert.ok(touched.every(name => /^(inventory|public)\./.test(name) || name.startsWith("inventory.rpc.")));
  }
});
