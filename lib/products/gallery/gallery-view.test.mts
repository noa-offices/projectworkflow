import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_GALLERY_STATE,
  OLD_REMOVAL_NOTE,
  UPDATE_AVAILABLE_TEXT,
  removedDateText,
  restoreButtonLabel,
  restoreMessage,
  updateTagText,
  buildGalleryQuery,
  clearedGalleryFilters,
  editFormProblem,
  filterOptionLabel,
  formatTagInput,
  hasActiveGalleryFilters,
  lastQuotedText,
  mergeCandidates,
  parseGalleryQuery,
  parseTagInput,
  fullDetailHref,
  quotedText,
  showingText,
  subCategoryLabel,
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
});

test("URL: build leaves defaults out; parse reads it back; a plain URL is the empty state", () => {
  assert.equal(buildGalleryQuery(EMPTY_GALLERY_STATE), "");
  const state = { query: " buddy chair ", brandId: BRAND, categoryId: CAT, subCategoryId: SUB, currency: "AED", tag: "office", sort: "newest" as const, updateAvailable: true };
  const text = buildGalleryQuery(state);
  assert.equal(text, `q=buddy+chair&brand=${BRAND}&category=${CAT}&sub=${SUB}&currency=AED&tag=office&sort=newest&update=1`);
  const params = new URLSearchParams(text);
  assert.deepEqual(parseGalleryQuery((key) => params.get(key)), { ...state, query: " buddy chair ".trim() });
  assert.deepEqual(parseGalleryQuery(() => undefined), EMPTY_GALLERY_STATE);
});

test("URL: unusable values are dropped, never trusted", () => {
  const parsed = parseGalleryQuery(read({ brand: "nope", category: "x,y", sub: "nope", currency: "e1", tag: "x".repeat(40), sort: "weird", hidden: "1" }));
  assert.deepEqual(parsed, EMPTY_GALLERY_STATE);
  assert.equal(parseGalleryQuery(read({ currency: "aed" })).currency, "AED", "currency is upper-cased");
  assert.equal(parseGalleryQuery(read({ sub: SUB })).subCategoryId, SUB, "the sub-category works without a category");
  assert.equal(buildGalleryQuery({ ...EMPTY_GALLERY_STATE, subCategoryId: SUB }), `sub=${SUB}`, "and is written without one");
  assert.equal(buildGalleryQuery(EMPTY_GALLERY_STATE), "", "edit mode and the old hidden key are never in the URL");
  assert.equal(parseGalleryQuery(read({ q: "x".repeat(300) })).query.length, 100);
});

test("filters: active-filter rule; clearing keeps the sort; category and sub-category are independent", () => {
  assert.equal(hasActiveGalleryFilters(EMPTY_GALLERY_STATE), false);
  assert.equal(hasActiveGalleryFilters({ ...EMPTY_GALLERY_STATE, sort: "name" }), false, "sort is a view, not a filter");
  assert.equal(hasActiveGalleryFilters({ ...EMPTY_GALLERY_STATE, tag: "office" }), true);
  assert.equal(hasActiveGalleryFilters({ ...EMPTY_GALLERY_STATE, subCategoryId: SUB }), true, "a sub-category alone is a filter");
  assert.equal(hasActiveGalleryFilters({ ...EMPTY_GALLERY_STATE, query: "  " }), false);
  const cleared = clearedGalleryFilters({ ...EMPTY_GALLERY_STATE, brandId: BRAND, categoryId: CAT, subCategoryId: SUB, tag: "x", sort: "name" });
  assert.deepEqual(cleared, { ...EMPTY_GALLERY_STATE, sort: "name" });
});

test("sub-category label: the name and count; the parent only where two sub-categories share a name", () => {
  const subs = [
    { id: "s1", name: "Executive", parentCategoryId: "p1", parentCategoryName: "Desk", count: 2 },
    { id: "s2", name: "Executive", parentCategoryId: "p2", parentCategoryName: "Chair", count: 1 },
    { id: "s3", name: "Task", parentCategoryId: "p2", parentCategoryName: "Chair", count: 4 },
  ];
  assert.equal(subCategoryLabel(subs[0], subs), "Desk / Executive (2)");
  assert.equal(subCategoryLabel(subs[1], subs), "Chair / Executive (1)");
  assert.equal(subCategoryLabel(subs[2], subs), "Task (4)");
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

test("Open full detail uses the canonical Product Management URL", () => {
  assert.equal(fullDetailHref("t 1"), "/products/manage?template=t%201");
});

test('"Update available" tag: exactly that text for an open offer, nothing otherwise (an ignored offer is not flagged by the server)', () => {
  assert.equal(UPDATE_AVAILABLE_TEXT, "Update available");
  assert.equal(updateTagText({ updateAvailable: true }), "Update available");
  assert.equal(updateTagText({ updateAvailable: false }), null);
  assert.equal(updateTagText({}), null);
  assert.doesNotMatch(UPDATE_AVAILABLE_TEXT, /review/i);
});

test("the Update available filter is in the URL (update=1), counts as a filter and is cleared by Clear filters", () => {
  const params = new URLSearchParams("update=1");
  const state = parseGalleryQuery((key) => params.get(key));
  assert.equal(state.updateAvailable, true);
  assert.equal(buildGalleryQuery(state), "update=1");
  assert.equal(hasActiveGalleryFilters(state), true);
  assert.equal(clearedGalleryFilters(state).updateAvailable, false);
  assert.equal(parseGalleryQuery((key) => (key === "update" ? "yes" : undefined)).updateAvailable, false);
});

test("restore messages and button labels", () => {
  assert.equal(restoreMessage("restored"), "Item restored.");
  assert.equal(restoreMessage("allowed_again"), "Allowed again. It will return when this configuration is quoted next time.");
  assert.match(restoreMessage("not_found"), /not found/);
  assert.equal(restoreButtonLabel({ hasSnapshot: true }), "Restore");
  assert.equal(restoreButtonLabel({ hasSnapshot: false }), "Allow again");
  assert.equal(OLD_REMOVAL_NOTE, "Old removal: Restore will only allow it again");
  assert.equal(removedDateText("2026-10-12T10:00:00Z"), "Removed 12 Oct 2026");
  assert.equal(removedDateText(""), "");
});
