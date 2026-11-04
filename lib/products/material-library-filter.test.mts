import assert from "node:assert/strict";
import test from "node:test";
import { buildBrandRows, defaultMaterialLibraryFilters as base, filterMaterialGroups, materialLibraryChips, materialLibraryCountText, materialLibraryQuery, noMaterialResultsText, showsBrandLevel, toggleNeedsReview, type LibraryGroup } from "./material-library-filter.js";

const group = (id: string, brandId: string, name: string, extra: Partial<LibraryGroup> = {}): LibraryGroup => ({ activeCount: 3, brandId, id, isActive: true, name, needsReview: false, searchText: `${name} brand${brandId}`.toLowerCase(), thumbs: [], updatedAt: "2026-01-01", ...extra });
const groups = [
  group("1", "a", "Leather", { activeCount: 10, searchText: "leather soft hide cow", updatedAt: "2026-03-01" }),
  group("2", "a", "Fabric", { needsReview: true, updatedAt: "2026-02-01" }),
  group("3", "b", "Wood", { isActive: false, activeCount: 1 }),
];
const ids = (list: LibraryGroup[]) => list.map((item) => item.id);

test("search needs every word, and the brand, group and status filters apply together", () => {
  assert.deepEqual(ids(filterMaterialGroups(groups, { ...base, q: "soft  HIDE" })), ["1"]);
  assert.deepEqual(ids(filterMaterialGroups(groups, { ...base, q: "soft nothing" })), []);
  assert.deepEqual(ids(filterMaterialGroups(groups, { ...base, brand: "a" })), ["1", "2"]); // newest first
  assert.deepEqual(ids(filterMaterialGroups(groups, { ...base, group: "Wood" })), ["3"]);
  assert.deepEqual(ids(filterMaterialGroups(groups, { ...base, status: "inactive" })), ["3"]);
  assert.deepEqual(ids(filterMaterialGroups(groups, { ...base, status: "needs_review" })), ["2"]);
  assert.deepEqual(ids(filterMaterialGroups(groups, { ...base, brand: "b", status: "active" })), []);
  assert.deepEqual(ids(filterMaterialGroups(groups, { ...base, sort: "materials" })), ["1", "2", "3"]);
  assert.deepEqual(ids(filterMaterialGroups(groups, { ...base, sort: "name" })), ["2", "1", "3"]);
});

test("brand cards show until something narrows the list", () => {
  assert.equal(showsBrandLevel(base), true);
  assert.equal(showsBrandLevel({ ...base, q: "x" }), false);
  assert.equal(showsBrandLevel({ ...base, status: "active" }), false);
  assert.equal(showsBrandLevel({ ...base, level: "groups" }), false);
  assert.equal(showsBrandLevel({ ...base, brand: "a" }), false);
});

test("brand rows count active materials, mix up to 5 pictures and sort by name", () => {
  const t = (code: string) => ({ code, url: null });
  const rows = buildBrandRows(
    [{ id: "b", name: "Zed", code: null, isActive: true }, { id: "a", name: "Arca", code: "AR", isActive: true }, { id: "c", name: "Empty", code: null, isActive: true }],
    [group("1", "a", "L", { thumbs: [t("1"), t("2"), t("3")] }), group("2", "a", "F", { thumbs: [t("4"), t("5"), t("6")] }), group("3", "b", "W", { activeCount: 1 })],
  );
  assert.deepEqual(rows.map((row) => row.brand.name), ["Arca", "Empty", "Zed"]);
  assert.equal(rows[0].materials, 6);
  assert.deepEqual(rows[0].thumbs.map((thumb) => thumb.code), ["1", "4", "2", "5"]);
  assert.equal(rows[1].groups.length, 0);
});

test("chips follow the opened brand; Needs review toggles", () => {
  assert.deepEqual(materialLibraryChips(groups, ""), { groups: 3, active: 2, materials: 14, needsReview: 1, scoped: 3 });
  assert.deepEqual(materialLibraryChips(groups, "b"), { groups: 1, active: 0, materials: 1, needsReview: 0, scoped: 1 });
  const on = toggleNeedsReview(base);
  assert.equal(on.status, "needs_review");
  assert.equal(toggleNeedsReview(on).status, "");
});

test("count and empty texts", () => {
  assert.equal(materialLibraryCountText(2, 5, "groups"), "2 of 5 groups");
  assert.equal(noMaterialResultsText(" zzz "), 'No results for "zzz".');
  assert.equal(noMaterialResultsText(""), "No material groups match these filters.");
});

test("the address bar query keeps other params and leaves out defaults", () => {
  assert.equal(materialLibraryQuery(base, "other=1&libView=list&q=x"), "?other=1");
  assert.equal(materialLibraryQuery({ ...base, q: " a b ", brand: "a", status: "needs_review", view: "list", level: "groups", sort: "name" }), "?q=a+b&libBrand=a&libLevel=groups&libStatus=needs_review&libSort=name&libView=list");
});
