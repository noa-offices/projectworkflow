import assert from "node:assert/strict";
import test from "node:test";
import { buildProductFilters, pagination, searchFilter, requestFilters, movementFilters } from "./filters";

test("pagination uses 24 rows with inclusive ranges and safe integer pages", () => {
  assert.deepEqual(pagination(), { page: 1, page_size: 24, from: 0, to: 23 });
  assert.deepEqual(pagination(3), { page: 3, page_size: 24, from: 48, to: 71 });
  for (const page of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => pagination(page));
});

test("product plans default to active stock and validate sort, status, item type and location", () => {
  const plan = buildProductFilters({ search: 'Chair, (new) "A"', brand_id: "brand", category_id: "parent", subcategory_id: "child", location: "dubai_showroom", status: "hold", item_type: "accessory", sort: "quantity_desc" });
  assert.equal(plan.active, true);
  assert.equal(plan.location_column, "dubai_showroom_quantity");
  assert.equal(plan.brand_id, "brand");
  assert.equal(plan.category_id, "parent");
  assert.equal(plan.subcategory_id, "child");
  assert.equal(plan.status, "hold");
  assert.equal(plan.item_type, "accessory");
  assert.deepEqual(plan.order, { column: "quantity", ascending: false });
  assert.ok(plan.search?.includes('item_name.ilike."%Chair, (new) \\"A\\"%"'));
  assert.equal(buildProductFilters({ active: "all" }).active, null);
  assert.equal(buildProductFilters({ active: false }).active, false);
  assert.throws(() => buildProductFilters({ location: "some_column" as never }));
  assert.throws(() => buildProductFilters({ sort: "price" as never }));
  assert.throws(() => buildProductFilters({ status: "unknown" as never }));
  assert.throws(() => buildProductFilters({ item_type: "unknown" as never }));
});

test("search values are quoted as values and LIKE wildcards are escaped", () => {
  assert.equal(searchFilter("   "), null);
  assert.equal(searchFilter("a%_"), ['item_name', 'item_code', 'stock_ref', 'model_name'].map(field => `${field}.ilike.${JSON.stringify('%a\\%\\_%')}`).join(','));
  const attack = 'x),quantity.gt.0,(model.eq."x';
  assert.equal(searchFilter(attack), ['item_name', 'item_code', 'stock_ref', 'model_name'].map(field => `${field}.ilike.${JSON.stringify('%' + attack + '%')}`).join(','));
});

test("request and movement filters validate states, request kinds and date bounds", () => {
  assert.equal(requestFilters({ request_status: "pending_review", request_type: "book" }).request_type, "book");
  assert.throws(() => requestFilters({ request_status: "pending" as never }));
  assert.throws(() => requestFilters({ request_type: "stock_out" as never }));
  assert.throws(() => movementFilters({ from: "not a date" }));
  assert.throws(() => movementFilters({ from: "2026-10-23", to: "2026-10-22" }));
  assert.equal(movementFilters({ location: "sold" }).location, "sold");
});
