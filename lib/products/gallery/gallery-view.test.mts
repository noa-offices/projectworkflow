import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_GALLERY_STATE,
  buildGalleryQuery,
  categoryLine,
  clearedGalleryFilters,
  editFormProblem,
  filterOptionLabel,
  formatTagInput,
  hasActiveGalleryFilters,
  lastQuotedText,
  mergeCandidates,
  parseGalleryQuery,
  parseTagInput,
  productLibraryHref,
  quotedText,
  showingText,
  subCategoriesFor,
  withGalleryCategory,
} from "./gallery-view";

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CAT = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const SUB = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const read = (record: Record<string, string>) => (key: string) => record[key];

test("quoted text: once, N times, and the Dubai date", () => {
  assert.equal(quotedText(1), "Quoted once");
  assert.equal(quotedText(3), "Quoted 3 times");
  assert.equal(quotedText(0), "Quoted 0 times");
  assert.equal(lastQuotedText("2026-10-12T10:00:00Z"), "Last quoted 12 Oct 2026");
  assert.equal(lastQuotedText("2026-10-12T22:30:00Z"), "Last quoted 13 Oct 2026", "Asia/Dubai, not UTC");
  assert.equal(lastQuotedText(""), "");
  assert.equal(lastQuotedText("nope"), "");
  assert.equal(showingText(30, 112), "Showing 30 of 112");
  assert.equal(filterOptionLabel("LAS MOBILI", 12), "LAS MOBILI (12)");
  assert.equal(categoryLine({ categoryName: "Chairs", subCategoryName: "Task" }), "Chairs / Task");
  assert.equal(categoryLine({ categoryName: "Chairs", subCategoryName: "" }), "Chairs");
});

test("URL: build leaves defaults out; parse reads it back; a plain URL is the empty state", () => {
  assert.equal(buildGalleryQuery(EMPTY_GALLERY_STATE), "");
  const state = { query: " buddy chair ", brandId: BRAND, categoryId: CAT, subCategoryId: SUB, currency: "AED", tag: "office", sort: "newest" as const, showHidden: true };
  const text = buildGalleryQuery(state);
  assert.equal(text, `q=buddy+chair&brand=${BRAND}&category=${CAT}&sub=${SUB}&currency=AED&tag=office&sort=newest&hidden=1`);
  const params = new URLSearchParams(text);
  assert.deepEqual(parseGalleryQuery((key) => params.get(key)), { ...state, query: " buddy chair ".trim() });
  assert.deepEqual(parseGalleryQuery(() => undefined), EMPTY_GALLERY_STATE);
});

test("URL: unusable values are dropped, never trusted", () => {
  const parsed = parseGalleryQuery(read({ brand: "nope", category: "x,y", sub: SUB, currency: "e1", tag: "x".repeat(40), sort: "weird", hidden: "yes" }));
  assert.deepEqual(parsed, EMPTY_GALLERY_STATE);
  assert.equal(parseGalleryQuery(read({ currency: "aed" })).currency, "AED", "currency is upper-cased");
  assert.equal(parseGalleryQuery(read({ sub: SUB })).subCategoryId, "", "a sub-category needs its category");
  assert.equal(buildGalleryQuery({ ...EMPTY_GALLERY_STATE, subCategoryId: SUB }), "", "and is not written without one");
  assert.equal(parseGalleryQuery(read({ q: "x".repeat(300) })).query.length, 100);
});

test("filters: active-filter rule, clearing keeps sort and Show hidden, changing the category forgets the sub-category", () => {
  assert.equal(hasActiveGalleryFilters(EMPTY_GALLERY_STATE), false);
  assert.equal(hasActiveGalleryFilters({ ...EMPTY_GALLERY_STATE, sort: "name", showHidden: true }), false, "views are not filters");
  assert.equal(hasActiveGalleryFilters({ ...EMPTY_GALLERY_STATE, tag: "office" }), true);
  assert.equal(hasActiveGalleryFilters({ ...EMPTY_GALLERY_STATE, query: "  " }), false);
  const cleared = clearedGalleryFilters({ ...EMPTY_GALLERY_STATE, brandId: BRAND, tag: "x", sort: "name", showHidden: true });
  assert.deepEqual(cleared, { ...EMPTY_GALLERY_STATE, sort: "name", showHidden: true });
  assert.deepEqual(withGalleryCategory({ ...EMPTY_GALLERY_STATE, categoryId: CAT, subCategoryId: SUB }, "other"), { ...EMPTY_GALLERY_STATE, categoryId: "other", subCategoryId: "" });
});

test("sub-categories: only those of the chosen category; none without a category", () => {
  const subs = [
    { id: SUB, name: "Task", parentCategoryId: CAT, count: 2 },
    { id: "s2", name: "Sofa", parentCategoryId: "other", count: 1 },
  ];
  assert.deepEqual(subCategoriesFor(subs, CAT).map((entry) => entry.id), [SUB]);
  assert.deepEqual(subCategoriesFor(subs, ""), []);
});

test("merge candidates: other items of the SAME template only, each once", () => {
  const item = (id: string, templateId: string) => ({ id, templateId });
  const source = item("a", "t1");
  const list = [item("a", "t1"), item("b", "t1"), item("c", "t2"), item("b", "t1"), item("d", "t1")];
  assert.deepEqual(mergeCandidates(list, source).map((entry) => entry.id), ["b", "d"]);
  assert.deepEqual(mergeCandidates([item("c", "t2")], source), []);
});

test("tag input: comma separated, trimmed, lower-cased, unique; the dialog explains limit problems", () => {
  assert.deepEqual(parseTagInput(" Chair, office,, chair ,"), ["chair", "office"]);
  assert.equal(formatTagInput(["a", "b"]), "a, b");
  assert.equal(editFormProblem("Buddy", "chair, office"), null);
  assert.equal(editFormProblem("", ""), null, "empty name clears it");
  assert.match(editFormProblem("x".repeat(121), "") ?? "", /120/);
  assert.match(editFormProblem("ok", Array.from({ length: 21 }, (_, i) => `t${i}`).join(",")) ?? "", /20 tags/);
  assert.match(editFormProblem("ok", "x".repeat(31)) ?? "", /30/);
});

test("the product link opens the library page of the product", () => {
  assert.equal(productLibraryHref("t 1"), "/products?template=t%201");
});
