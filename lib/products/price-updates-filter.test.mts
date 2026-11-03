import assert from "node:assert/strict";
import test from "node:test";
import { chipCounts, defaultPriceUpdatesFilters, filterPriceUpdates, noPriceUpdatesText, parsePriceUpdatesFilters, priceUpdatesFilterQuery, toggleStatusChip, type PriceUpdatesRow } from "./price-updates-filter.js";

const states = ["current", "update_available", "partially_checked", "needs_attention", "in_review", "ready_to_complete", "legacy_manual"];
const rows: PriceUpdatesRow[] = [
  { brandId: "1", name: "Colan", state: "legacy_manual", method: "manual" },
  { brandId: "2", name: "Arca", state: "needs_attention", method: "codes" },
  { brandId: "3", name: "Bolia", state: "current", method: "codes" },
  { brandId: "4", name: "Calia", state: "needs_attention", method: "codes" },
  { brandId: "5", name: "Broken", state: "current", method: "codes", failed: true },
];
const ids = (list: PriceUpdatesRow[]) => list.map((row) => row.brandId);

test("search is by brand name, ignoring case; method and status apply at once", () => {
  assert.deepEqual(ids(filterPriceUpdates(rows, { ...defaultPriceUpdatesFilters, q: "  AR" })), ["2"]);
  assert.deepEqual(ids(filterPriceUpdates(rows, { ...defaultPriceUpdatesFilters, method: "manual" })), ["1"]);
  assert.deepEqual(ids(filterPriceUpdates(rows, { ...defaultPriceUpdatesFilters, method: "codes" })), ["2", "3", "4"]); // a Brand with unreadable status has no known method
  assert.deepEqual(ids(filterPriceUpdates(rows, { ...defaultPriceUpdatesFilters, status: "needs_attention" })), ["2", "4"]);
  assert.deepEqual(ids(filterPriceUpdates(rows, { q: "cal", status: "needs_attention", method: "codes" })), ["4"]);
  assert.deepEqual(ids(filterPriceUpdates(rows, defaultPriceUpdatesFilters)), ["1", "2", "3", "4", "5"]); // the notice card shows when no status is chosen
});

test("an empty result has the clear message", () => {
  assert.deepEqual(filterPriceUpdates(rows, { ...defaultPriceUpdatesFilters, q: "zzz" }), []);
  assert.equal(noPriceUpdatesText("zzz"), 'No brands match "zzz".');
});

test("chips count by state, follow search and method, and toggle", () => {
  assert.deepEqual(chipCounts(rows, { q: "", method: "all" }), { current: 1, update_available: 0, partially_checked: 0, needs_attention: 2 }); // the unreadable Brand is not counted; legacy_manual has no chip
  assert.deepEqual(chipCounts(rows, { q: "cal", method: "all" }), { current: 0, update_available: 0, partially_checked: 0, needs_attention: 1 });
  assert.deepEqual(chipCounts(rows, { q: "", method: "manual" }), { current: 0, update_available: 0, partially_checked: 0, needs_attention: 0 });
  const on = toggleStatusChip(defaultPriceUpdatesFilters, "needs_attention");
  assert.equal(on.status, "needs_attention");
  assert.equal(toggleStatusChip(on, "needs_attention").status, "");
  assert.equal(toggleStatusChip(on, "current").status, "current");
});

test("the URL is read with safe defaults; the old ?state= works", () => {
  const read = (query: string) => parsePriceUpdatesFilters((key) => new URLSearchParams(query).get(key), states);
  assert.deepEqual(read(""), defaultPriceUpdatesFilters);
  assert.deepEqual(read("q=%20col&status=needs_attention&method=MANUAL"), { q: "col", status: "needs_attention", method: "manual" });
  assert.equal(read("state=current").status, "current");
  assert.equal(read("status=bogus").status, "");
  assert.equal(read("method=bogus").method, "all");
});

test("the address bar query keeps other parameters, drops the old state and leaves out defaults", () => {
  assert.equal(priceUpdatesFilterQuery(defaultPriceUpdatesFilters, "state=current&other=1"), "?other=1");
  assert.equal(priceUpdatesFilterQuery({ q: "a b", status: "current", method: "codes" }), "?q=a+b&status=current&method=codes");
  assert.equal(priceUpdatesFilterQuery(defaultPriceUpdatesFilters, "q=x&status=current&method=manual"), "");
});
