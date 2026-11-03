import assert from "node:assert/strict";
import test from "node:test";
import type { ManualPriceState } from "./manual-price-check.js";
import { buildManualProductRows, filterManualRows, manualCategories, manualProgressText, manualStatusCounts, manualStatusFromLabel, sortManualRows, type ManualProductInput } from "./manual-brand-products.js";

const BRAND = "colan";
const product = (id: string, name: string, version: number, main = "chairs"): ManualProductInput => ({ id, brand_id: BRAND, template_name: name, pricing_version: version, main_category_id: main, sub_category_id: "swivel" });
const categories = new Map([["chairs", "Chairs"], ["tables", "Tables"], ["swivel", "Swivel"]]);
const state = (hasRelease: boolean): ManualPriceState => new Map([[BRAND, {
  brandId: BRAND,
  releases: hasRelease ? [{ id: "r1", brandId: BRAND, effectiveFrom: "2026-01-15", note: "List", createdAt: "2026-01-15T00:00:00Z" }] : [],
  checks: [
    { releaseId: "r1", templateId: "checked", pricingVersion: "5", checkedAt: "2026-02-03T08:00:00Z", checkedByName: "Sara Khan" },
    { releaseId: "r1", templateId: "edited", pricingVersion: "4", checkedAt: "2026-02-03T08:00:00Z" }, // product is now at version 6
  ],
}]]);
const products = [product("due", "Zeta Chair", 5), product("checked", "Alpha Chair", 5), product("edited", "Mid Chair", 6, "tables"), product("due2", "Beta Chair", 1)];
const rows = () => buildManualProductRows(products, categories, state(true), "2026-02-10");

test("statuses come from the shared resolver, with the Product Library wording", () => {
  const byId = Object.fromEntries(rows().map((row) => [row.id, row]));
  assert.deepEqual([byId.due.status, byId.due.label], ["price_update_due", "Price update due"]);
  assert.deepEqual([byId.checked.status, byId.checked.label], ["price_checked", "Price checked"]);
  assert.equal(byId.edited.status, "edited_since_check");
  assert.match(byId.checked.detail, /^Checked on 3 Feb 2026 by Sara Khan$/);
  assert.equal(byId.due.category, "Chairs / Swivel"); assert.equal(byId.edited.mainCategory, "Tables");
});

test("counts and the progress line", () => {
  const counts = manualStatusCounts(rows());
  assert.deepEqual(counts, { due: 2, checked: 1, edited: 1, neutral: 0 });
  assert.equal(manualProgressText(counts, true), "2 due · 1 checked · 1 edited since check");
  assert.equal(manualProgressText({ due: 0, checked: 3, edited: 0, neutral: 0 }, true), "3 checked");
  assert.equal(manualProgressText({ due: 0, checked: 0, edited: 0, neutral: 0 }, true), "No products.");
});

test("with no release every product is neutral and the message says so", () => {
  const neutral = buildManualProductRows(products, categories, state(false), "2026-02-10");
  assert.ok(neutral.every((row) => row.status === "legacy_manual"));
  const counts = manualStatusCounts(neutral);
  assert.equal(counts.neutral, 4);
  assert.equal(manualProgressText(counts, false), "No price list released yet.");
});

test("filters by category, status and name", () => {
  const all = rows();
  assert.deepEqual(filterManualRows(all, { status: "due" }).map((r) => r.id).sort(), ["due", "due2"]);
  assert.deepEqual(filterManualRows(all, { status: "checked" }).map((r) => r.id), ["checked"]);
  assert.deepEqual(filterManualRows(all, { status: "edited" }).map((r) => r.id), ["edited"]);
  assert.deepEqual(filterManualRows(all, { category: "Tables" }).map((r) => r.id), ["edited"]);
  assert.deepEqual(filterManualRows(all, { search: "  ALPHA " }).map((r) => r.id), ["checked"]);
  assert.equal(filterManualRows(all, {}).length, 4);
  assert.deepEqual(manualCategories(all), ["Chairs", "Tables"]);
});

test("default sort: due first, then edited, then checked; by name inside a group", () => {
  assert.deepEqual(sortManualRows(rows()).map((r) => r.id), ["due2", "due", "edited", "checked"]);
  const input = rows(); sortManualRows(input);
  assert.deepEqual(input.map((r) => r.id), rows().map((r) => r.id)); // the input list is not changed
});

test("a label from the window maps back to its status; other labels do not", () => {
  assert.equal(manualStatusFromLabel("Price checked"), "price_checked");
  assert.equal(manualStatusFromLabel("Price update due"), "price_update_due");
  assert.equal(manualStatusFromLabel("Edited since check"), "edited_since_check");
  assert.equal(manualStatusFromLabel("Needs attention"), null);
});
