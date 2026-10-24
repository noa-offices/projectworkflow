import assert from "node:assert/strict";
import test from "node:test";
import { categoryTree, pick, PRODUCT_COLUMNS, PRODUCT_REQUEST_COLUMNS, summarizeStock } from "./mapping";
import type { InventoryCategory, InventoryProductRow, InventoryProductRequestRow } from "./types";

test("product mapping discards unselected cost properties", () => {
  const mapped = pick({ id: "p", price: 100, total_cost: 200, costs: { price: 100 } } as unknown as InventoryProductRow, PRODUCT_COLUMNS);
  assert.equal(mapped.id, "p");
  for (const key of ["price", "total_cost", "costs"]) assert.equal(key in mapped, false);
});
test("stock summary counts the inclusive low threshold and excludes sold from live quantity", () => {
  const stock = { warehouse_quantity: 2, dubai_showroom_quantity: 1, abudhabi_showroom_quantity: 0, mockup_quantity: 0, temporary_out_quantity: 0, sold_quantity: 50 };
  assert.deepEqual(summarizeStock([{ ...stock, quantity: 3 }, { ...stock, warehouse_quantity: 0, dubai_showroom_quantity: 0, quantity: 0 }]), {
    product_count: 1, total_live_quantity: 3,
    location_quantities: { warehouse: 2, dubai_showroom: 1, abudhabi_showroom: 0, mockup: 0, temporary_out: 0, sold: 100 },
    location_product_counts: { warehouse: 1, dubai_showroom: 1, abudhabi_showroom: 0, mockup: 0, temporary_out: 0, sold: 2 },
    item_type_counts: { product: 0, accessory: 0, temporary: 0 },
  });
});
test("stock summary counts units and distinct live products per location and type", () => {
  const zero = { warehouse_quantity: 0, dubai_showroom_quantity: 0, abudhabi_showroom_quantity: 0, mockup_quantity: 0, temporary_out_quantity: 0, sold_quantity: 0 };
  const result = summarizeStock([
    { ...zero, item_type: "product", warehouse_quantity: 5, dubai_showroom_quantity: 2, quantity: 7, sold_quantity: 4 },
    { ...zero, item_type: "accessory", warehouse_quantity: 3, quantity: 3 },
    { ...zero, item_type: "temporary", mockup_quantity: 1, quantity: 1 },
    { ...zero, item_type: "product", quantity: 0, sold_quantity: 9 },
  ]);
  assert.equal(result.total_live_quantity, 11);
  assert.equal(result.product_count, 3);
  assert.deepEqual(result.item_type_counts, { product: 1, accessory: 1, temporary: 1 });
  assert.deepEqual(result.location_quantities, { warehouse: 8, dubai_showroom: 2, abudhabi_showroom: 0, mockup: 1, temporary_out: 0, sold: 13 });
  assert.deepEqual(result.location_product_counts, { warehouse: 2, dubai_showroom: 1, abudhabi_showroom: 0, mockup: 1, temporary_out: 0, sold: 2 });
});
test("category tree sorts without mutating rows, preserves orphans, and rejects cycles", () => {
  const row = (id: string, parent_id: string | null, sort_order = 0) => ({ id, parent_id, name: id, sort_order } as InventoryCategory);
  const rows = [row("child", "parent"), row("parent", null, 2), row("orphan", "hidden")];
  const tree = categoryTree(rows);
  assert.deepEqual(tree.map(n => n.id), ["orphan", "parent"]);
  assert.equal(tree[1].children[0].id, "child");
  assert.equal("children" in rows[0], false);
  assert.throws(() => categoryTree([row("a", "b"), row("b", "a")]));
});


test("product mapping preserves nullable optional identity fields and the existing stock reference", () => {
  const mapped = pick({ stock_ref: "WH-2026-0042", item_code: null, model_name: null } as InventoryProductRow, PRODUCT_COLUMNS);
  assert.equal(mapped.stock_ref, "WH-2026-0042");
  assert.equal(mapped.item_code, null);
  assert.equal(mapped.model_name, null);
});

test("pending product request mapping preserves an unassigned stock reference", () => {
  const mapped = pick({ stock_ref: null, item_code: null, model_name: null } as InventoryProductRequestRow, PRODUCT_REQUEST_COLUMNS);
  assert.equal(mapped.stock_ref, null);
  assert.equal(mapped.item_code, null);
  assert.equal(mapped.model_name, null);
});
