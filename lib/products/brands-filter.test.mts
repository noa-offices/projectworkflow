import assert from "node:assert/strict";
import test from "node:test";
import { brandCountText, brandFilterQuery, defaultBrandFilters, filterBrands, noBrandsMatchText, parseBrandFilters, type BrandListRow } from "./brands-filter.js";

const rows: BrandListRow[] = [
  { id: "1", name: "Colan", code: "COL", origin: "China", isActive: true, method: "manual" },
  { id: "2", name: "Arca", code: "ARC", origin: "Italy", isActive: true, method: "codes" },
  { id: "3", name: "Old Brand", code: null, origin: null, isActive: false, method: "codes" },
];
const ids = (list: BrandListRow[]) => list.map((row) => row.id);

test("search matches name, code and origin, ignoring case and spaces around the text", () => {
  assert.deepEqual(ids(filterBrands(rows, { ...defaultBrandFilters, q: "  COLAN " })), ["1"]);
  assert.deepEqual(ids(filterBrands(rows, { ...defaultBrandFilters, q: "arc" })), ["2"]); // code and name
  assert.deepEqual(ids(filterBrands(rows, { ...defaultBrandFilters, q: "ital" })), ["2"]); // origin
  assert.deepEqual(ids(filterBrands(rows, { ...defaultBrandFilters, q: "" })), ["1", "2", "3"]);
});

test("status and method filters apply on their own and together", () => {
  assert.deepEqual(ids(filterBrands(rows, { ...defaultBrandFilters, status: "active" })), ["1", "2"]);
  assert.deepEqual(ids(filterBrands(rows, { ...defaultBrandFilters, status: "archived" })), ["3"]);
  assert.deepEqual(ids(filterBrands(rows, { ...defaultBrandFilters, method: "manual" })), ["1"]);
  assert.deepEqual(ids(filterBrands(rows, { ...defaultBrandFilters, method: "codes" })), ["2", "3"]);
  assert.deepEqual(ids(filterBrands(rows, { q: "brand", status: "archived", method: "codes" })), ["3"]);
});

test("an empty result has the clear message", () => {
  assert.deepEqual(filterBrands(rows, { ...defaultBrandFilters, q: "zzz" }), []);
  assert.equal(noBrandsMatchText("zzz"), 'No brands match "zzz".');
  assert.equal(noBrandsMatchText("  "), "No brands match the filters.");
  assert.equal(brandCountText(2, 3), "2 of 3 brands");
});

test("the URL is read with safe defaults and old status values still work", () => {
  const read = (query: string) => parseBrandFilters((key) => new URLSearchParams(query).get(key));
  assert.deepEqual(read(""), defaultBrandFilters);
  assert.deepEqual(read("q=%20col%20&status=active&method=manual"), { q: "col", status: "active", method: "manual" });
  assert.equal(read("status=inactive").status, "archived");
  assert.equal(read("status=archive").status, "archived");
  assert.equal(read("status=ARCHIVED").status, "archived");
  assert.deepEqual(read("status=nonsense&method=nonsense"), defaultBrandFilters);
  assert.equal(read(`q=${"x".repeat(500)}`).q.length, 100);
});

test("the address bar query keeps other parameters and leaves out defaults", () => {
  assert.equal(brandFilterQuery(defaultBrandFilters, "brand=abc"), "?brand=abc");
  assert.equal(brandFilterQuery({ q: "col", status: "active", method: "manual" }, "brand=abc&category=c1"), "?brand=abc&category=c1&q=col&status=active&method=manual");
  assert.equal(brandFilterQuery(defaultBrandFilters, "q=old&status=active&method=codes"), "");
  assert.equal(brandFilterQuery({ ...defaultBrandFilters, q: "a b" }, new URLSearchParams("")), "?q=a+b");
});
