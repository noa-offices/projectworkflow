import assert from "node:assert/strict";
import test from "node:test";
import { manualLineFromTarget, sharedLineCurrency } from "./manual-price-lines.js";
import type { ProductPriceInput } from "./supplier-price-contracts.js";
import { supplierTargetWrite } from "./supplier-price-repository.js";
import { brandPriceTargets } from "./supplier-price-targets.js";

const columns = [{ id: "col-a", label: "Grade A", dimension_code: "grade_a" }, { id: "col-ap", label: "Grade A+", dimension_code: "grade_a_plus" }];
const base = { id: "rose", brand_id: "colan", template_name: "Rose Chair", pricing_version: 3, currency: "USD", item_code: null, default_unit_price: null, variant_pricing: [], category_pricing: [], desking_size_pricing: [], accessory_pricing: [] };

/** A Rose-like template with NO codes anywhere. */
const rose = (): ProductPriceInput => ({
  ...base,
  category_pricing: [{ id: "g1", group_name: "Chair", is_active: true, price_columns: columns, price_categories: ["col-a", "col-ap"], items: [{ id: "r1", variant_name: "Rose armchair", currency: "USD", is_active: true, prices: { "col-a": 319, "col-ap": 349 } }] }],
  accessory_pricing: [{ id: "acc1", item_name: "Arm pad", price: 50, currency: "USD", is_active: true }],
} as unknown as ProductPriceInput);

/** The same shape with codes. */
const coded = (): ProductPriceInput => {
  const t = rose() as unknown as { category_pricing: Array<{ items: Array<Record<string, unknown>> }>; accessory_pricing: Array<Record<string, unknown>> };
  t.category_pricing[0].items[0].supplier_price_list_code = "RC-1";
  t.accessory_pricing[0].supplier_price_list_code = "AP-1";
  return t as unknown as ProductPriceInput;
};

test("default behaviour: rows without a code are still skipped", () => {
  assert.deepEqual(brandPriceTargets([rose()]), []);
  assert.deepEqual(brandPriceTargets([rose()], [], {}), []);
  assert.deepEqual(brandPriceTargets([rose()], [], { includeCodeless: false }), []);
});

test("default behaviour: a coded fixture gives exactly the same targets as before, with or without the option", () => {
  const plain = brandPriceTargets([coded()]);
  assert.equal(plain.length, 3);
  assert.deepEqual(plain.map((t) => t.code).sort(), ["AP-1", "RC-1", "RC-1"]);
  assert.deepEqual(brandPriceTargets([coded()], [], { includeCodeless: false }), plain);
  assert.deepEqual(brandPriceTargets([coded()], [], { includeCodeless: true }), plain); // the option only adds rows, it never changes coded ones
});

test("a Rose-like template with no codes gives USD lines with readable names", () => {
  const targets = brandPriceTargets([rose()], [], { includeCodeless: true });
  assert.equal(targets.length, 3);
  const lines = targets.map(manualLineFromTarget);
  assert.deepEqual(lines.map((l) => [l.code, l.label, l.price, l.currency]), [["Rose armchair", "Grade A", 319, "USD"], ["Rose armchair", "Grade A+", 349, "USD"], ["Arm pad", "Price", 50, "USD"]]);
  assert.equal(sharedLineCurrency(lines), "USD");
  lines.forEach((l) => { assert.ok(l.code.trim()); assert.ok(l.label.trim()); });
});

test("a codeless target keeps the same key, ids and physical field as a coded one", () => {
  const a = brandPriceTargets([rose()], [], { includeCodeless: true }), b = brandPriceTargets([coded()]);
  assert.deepEqual(a.map((t) => [t.key, t.architecture, t.group_id, t.row_id, t.column_id, t.physical_field, t.price, t.currency]), b.map((t) => [t.key, t.architecture, t.group_id, t.row_id, t.column_id, t.physical_field, t.price, t.currency]));
});

test("a save for a codeless line builds the same write as a coded line", () => {
  const history = { note: "n" };
  for (const index of [0, 2]) {
    const codeless = brandPriceTargets([rose()], [], { includeCodeless: true })[index], withCode = brandPriceTargets([coded()])[index];
    const w1 = supplierTargetWrite(codeless, new Map([["rose", structuredClone(rose())]]), 400, "USD", history);
    const w2 = supplierTargetWrite(withCode, new Map([["rose", structuredClone(coded())]]), 400, "USD", history);
    assert.equal(w1.mode, w2.mode);
    assert.deepEqual(w1.history, w2.history);
    const strip = (value: unknown) => JSON.parse(JSON.stringify(value, (key, v) => key === "supplier_price_list_code" ? undefined : v));
    assert.deepEqual(strip(w1.payload), strip(w2.payload));
  }
});

test("inactive rows and rows without stored ids are skipped even when codeless rows are kept", () => {
  const t = rose() as unknown as { category_pricing: Array<{ items: Array<Record<string, unknown>> }>; accessory_pricing: Array<Record<string, unknown>> };
  t.category_pricing[0].items[0].is_active = false;
  delete t.accessory_pricing[0].id;
  assert.deepEqual(brandPriceTargets([t as unknown as ProductPriceInput], [], { includeCodeless: true }), []);
});

test("a default price and mixed currencies", () => {
  const simple = { ...base, default_unit_price: 90, currency: "USD" } as unknown as ProductPriceInput;
  const lines = brandPriceTargets([simple], [], { includeCodeless: true }).map(manualLineFromTarget);
  assert.deepEqual(lines.map((l) => [l.code, l.label, l.price, l.currency]), [["Rose Chair", "Default price", 90, "USD"]]);
  const mixed = [{ ...lines[0] }, { ...lines[0], key: "x", currency: "AED" }];
  assert.equal(sharedLineCurrency(mixed), null);
});

test("window grid: variants become rows and price names become columns", async () => {
  const { groupPriceLines } = await import("./manual-price-lines.js");
  const t = rose() as unknown as { category_pricing: Array<{ items: Array<Record<string, unknown>> }> };
  t.category_pricing[0].items.push({ id: "r2", variant_name: "Footrest", currency: "USD", is_active: true, prices: { "col-a": 120 } }); // no Grade A+ price
  const lines = brandPriceTargets([t as unknown as ProductPriceInput], [], { includeCodeless: true }).map(manualLineFromTarget);
  const grid = groupPriceLines(lines);
  assert.deepEqual(grid.columns, ["Grade A", "Grade A+", "Price"]);
  assert.deepEqual(grid.rows.map((r) => r.name), ["Rose Chair - Rose armchair", "Rose Chair - Footrest", "Rose Chair - Arm pad"]);
  assert.deepEqual(grid.rows[0].cells.map((c) => c?.price ?? null), [319, 349, null]);
  assert.deepEqual(grid.rows[1].cells.map((c) => c?.price ?? null), [120, null, null]); // missing cells are null
  assert.equal(grid.rows[1].cells[1], null);
  assert.deepEqual(grid.rows[2].cells.map((c) => c?.price ?? null), [null, null, 50]);
});

test("window grid: a product with one price name has one column; names match ignoring case; a repeat gets its own column", async () => {
  const { groupPriceLines } = await import("./manual-price-lines.js");
  const mk = (key: string, rowKey: string, columnName: string, price: number): import("./manual-price-lines.js").ManualPriceLine => ({ key, code: rowKey, label: columnName, price, currency: "USD", rowKey, rowName: rowKey, columnName });
  assert.deepEqual(groupPriceLines([mk("1", "a", "Price", 1), mk("2", "b", "Price", 2)]).columns, ["Price"]);
  assert.deepEqual(groupPriceLines([mk("1", "a", "GRADE A", 1), mk("2", "b", "Grade a", 2)]).columns, ["GRADE A"]);
  const dup = groupPriceLines([mk("1", "a", "Grade A", 1), mk("2", "a", "Grade A", 2)]);
  assert.deepEqual(dup.columns, ["Grade A", "Grade A"]);
  assert.deepEqual(dup.rows[0].cells.map((c) => c?.price), [1, 2]);
});
