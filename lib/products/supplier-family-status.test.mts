import assert from "node:assert/strict";
import test from "node:test";
import { resolveSupplierBrandPriceStatus, resolveSupplierFamilyPriceStatus, supplierFamilyStatusLabels, supplierFamilyStatusPresentation, type SupplierResponsibilityInput, type SupplierVersionRef } from "./supplier-family-status.js";
import { authoritativeSupplierFamilyReviewFacts, type SupplierFamilyReviewFact } from "./supplier-price-repository.js";

const TODAY = "2026-10-20";
const FAMILY = "fam-1";
const v = (id: string, extra: Partial<SupplierVersionRef> = {}): SupplierVersionRef => ({ id, title: `List ${id}`, status: "imported", effective_from: null, created_at: "2026-01-01T00:00:00Z", ...extra });
const responsibility = (versions: SupplierVersionRef[], definitionId = "def-A", definitionName = "LAS Furniture", templateId = FAMILY): SupplierResponsibilityInput => ({ templateId, definitionId, definitionName, versions });
const fact = (over: Partial<SupplierFamilyReviewFact> = {}): SupplierFamilyReviewFact => ({
  brandId: "brand", templateId: FAMILY, sourceId: "v1", batchId: "batch-1", batchStatus: "completed", completedAt: "2026-10-10T00:00:00Z", scope: "complete",
  inCoverage: true, hasReviewEvidence: true, totalTargets: 1, excludedTargets: 0, resolvedTargets: 1, unresolvedTargets: 0, fullyChecked: true, partiallyChecked: false, ...over,
});
const openFact = (over: Partial<SupplierFamilyReviewFact> = {}) => fact({ batchStatus: "review", completedAt: null, fullyChecked: false, partiallyChecked: false, ...over });
const resolve = (responsibilities: SupplierResponsibilityInput[], facts: SupplierFamilyReviewFact[], families = [{ templateId: FAMILY, brandId: "brand" }]) =>
  resolveSupplierFamilyPriceStatus({ businessDate: TODAY, families, responsibilities, facts, legacyDetail: () => "Interval check: last checked 2026-01-01" });
const one = (responsibilities: SupplierResponsibilityInput[], facts: SupplierFamilyReviewFact[]) => resolve(responsibilities, facts)[0];

test("latest eligible open Family fact wins without deleting older batches or changing completed proof", () => {
  const old = openFact({ batchId: "a-old", batchCreatedAt: "2026-10-05T00:00:00Z", totalTargets: 225, unresolvedTargets: 225 });
  const current = openFact({ batchId: "z-current", batchCreatedAt: "2026-10-06T00:00:00Z", totalTargets: 10, resolvedTargets: 10, unresolvedTargets: 0 });
  const stored = [old, current];
  const selected = authoritativeSupplierFamilyReviewFacts(stored);
  assert.deepEqual(selected, [current]);
  assert.equal(stored.length, 2);
  assert.equal(one([responsibility([v("v1")])], selected).status, "ready_to_complete");
  const completed = fact();
  assert.equal(one([responsibility([v("v1")])], authoritativeSupplierFamilyReviewFacts([...stored, completed])).status, "price_checked");
});

test("abandoned latest review is ignored: another open review wins, otherwise update_available or completed proof", () => {
  const abandoned = openFact({ batchId: "left", batchStatus: "abandoned", batchCreatedAt: "2026-10-08", unresolvedTargets: 9 });
  const older = openFact({ batchId: "older", batchCreatedAt: "2026-10-07", unresolvedTargets: 0 });
  assert.equal(one([responsibility([v("v1")])], authoritativeSupplierFamilyReviewFacts([older, abandoned])).status, "ready_to_complete");
  assert.equal(one([responsibility([v("v1")])], authoritativeSupplierFamilyReviewFacts([abandoned])).status, "update_available");
  assert.equal(one([responsibility([v("v1")])], authoritativeSupplierFamilyReviewFacts([abandoned, fact()])).status, "price_checked");
});

test("open authority is scoped to exact Source Version and Family, excludes uncovered facts, and breaks time ties by ID", () => {
  const a = openFact({ batchId: "a", batchCreatedAt: "2026-10-06", totalTargets: 1, unresolvedTargets: 1 });
  const z = openFact({ batchId: "z", batchCreatedAt: "2026-10-06", unresolvedTargets: 0 });
  const otherSource = openFact({ sourceId: "other", batchId: "other" });
  const otherFamily = openFact({ templateId: "other-family", batchId: "family" });
  const uncovered = openFact({ batchId: "uncovered", batchCreatedAt: "2026-10-07", inCoverage: false });
  assert.deepEqual(authoritativeSupplierFamilyReviewFacts([a, z, otherSource, otherFamily, uncovered]), [z, otherSource, otherFamily]);
});

test("exact applicable version completed in full → price checked", () => {
  const status = one([responsibility([v("v1", { effective_from: "2026-10-01" })])], [fact({ sourceId: "v1" })]);
  assert.equal(status.status, "price_checked"); assert.equal(status.label, supplierFamilyStatusLabels.price_checked); assert.equal(status.source?.sourceId, "v1");
});

test("completed with excluded targets → partially checked, with progress and no false needs-attention", () => {
  const status = one([responsibility([v("v1")])], [fact({ sourceId: "v1", totalTargets: 20, resolvedTargets: 17, excludedTargets: 3, fullyChecked: false, partiallyChecked: true })]);
  assert.equal(status.status, "partially_checked"); assert.deepEqual(status.progress, { checked: 17, total: 20, excluded: 3, unresolved: 0 });
  assert.match(status.detail, /17 of 20 pricing targets checked · 3 excluded from Supplier source/);
});

test("open review with unresolved work → needs attention", () => {
  assert.equal(one([responsibility([v("v1")])], [openFact({ sourceId: "v1", totalTargets: 5, resolvedTargets: 3, unresolvedTargets: 2 })]).status, "needs_attention");
});

test("open review with everything resolved but not completed → ready to complete, never checked", () => {
  const status = one([responsibility([v("v1")])], [openFact({ sourceId: "v1", totalTargets: 5, resolvedTargets: 5, unresolvedTargets: 0 })]);
  assert.equal(status.status, "ready_to_complete"); assert.notEqual(status.status, "price_checked");
});

test("comparison still running → in review", () => {
  assert.equal(one([responsibility([v("v1")])], [openFact({ sourceId: "v1", batchStatus: "matching", totalTargets: 5, resolvedTargets: 2, unresolvedTargets: 0 })]).status, "in_review");
});

test("applicable version without a completed review → update available", () => {
  assert.equal(one([responsibility([v("v1")])], []).status, "update_available");
});

test("a completed review of an older version does not make the Family current; the newer applicable version is update available", () => {
  const versions = [v("v0", { effective_from: "2026-09-01" }), v("v1", { effective_from: "2026-10-15" })];
  const status = one([responsibility(versions)], [fact({ sourceId: "v0" })]);
  assert.equal(status.status, "update_available"); assert.equal(status.source?.sourceId, "v1");
});

test("coverage but no current version → no current price list, with the upcoming list as metadata", () => {
  const status = one([responsibility([v("nov", { effective_from: "2026-11-01" })])], []);
  assert.equal(status.status, "no_price_list"); assert.equal(status.upcoming?.sourceId, "nov"); assert.equal(status.upcoming?.effectiveFrom, "2026-11-01");
});

test("checked Family with a future list → price checked, and the future list is only a note", () => {
  const status = one([responsibility([v("v1", { effective_from: "2026-10-01" }), v("nov", { effective_from: "2026-11-01" })])], [fact({ sourceId: "v1" })]);
  assert.equal(status.status, "price_checked"); assert.equal(status.upcoming?.sourceId, "nov");
});

test("no Supplier coverage → legacy manual price check, using the caller's legacy detail", () => {
  const status = resolve([], [])[0];
  assert.equal(status.status, "legacy_manual"); assert.equal(status.detail, "Interval check: last checked 2026-01-01");
});

test("no review evidence is never checked", () => {
  const status = one([responsibility([v("v1")])], [fact({ sourceId: "v1", hasReviewEvidence: false, totalTargets: 0, resolvedTargets: 0, fullyChecked: false })]);
  assert.equal(status.status, "update_available");
});

test("partial progress on an open batch is never partially checked", () => {
  const status = one([responsibility([v("v1")])], [openFact({ sourceId: "v1", totalTargets: 5, resolvedTargets: 2, unresolvedTargets: 3 })]);
  assert.notEqual(status.status, "partially_checked"); assert.equal(status.status, "needs_attention");
});

test("several responsibilities for one Family: the worst status wins and both definitions stay in the detail", () => {
  const furniture = responsibility([v("v1")], "def-A", "LAS Furniture");
  const chairs = responsibility([v("c1")], "def-B", "LAS Chairs");
  const status = resolve([furniture, chairs], [fact({ sourceId: "v1" }), openFact({ sourceId: "c1", totalTargets: 4, unresolvedTargets: 1, resolvedTargets: 3 })])[0];
  assert.equal(status.status, "needs_attention");
  assert.match(status.detail, /LAS Chairs/); assert.match(status.detail, /LAS Furniture/);
  assert.equal(supplierFamilyStatusLabels.needs_attention, "Needs attention");
});

test("a completed fact for a different sourceId never counts as checked", () => {
  const status = one([responsibility([v("v1")])], [fact({ sourceId: "other-version" })]);
  assert.equal(status.status, "update_available");
});

test("excluded targets alone do not produce needs attention", () => {
  const status = one([responsibility([v("v1")])], [fact({ sourceId: "v1", totalTargets: 3, excludedTargets: 3, resolvedTargets: 0, fullyChecked: false, partiallyChecked: false })]);
  assert.notEqual(status.status, "needs_attention");
});

test("the status carries no edited-since-check claim it cannot prove", () => {
  const status = one([responsibility([v("v1")])], [fact({ sourceId: "v1" })]);
  assert.equal("editedSinceCheck" in status, false);
});

test("precedence: needs attention beats price checked for the same Family", () => {
  const status = one([responsibility([v("v1")], "a", "A"), responsibility([v("v2")], "b", "B")], [fact({ sourceId: "v1" }), openFact({ sourceId: "v2", unresolvedTargets: 1, totalTargets: 2, resolvedTargets: 1 })]);
  assert.equal(status.status, "needs_attention");
});

const status = (key: string) => ({ status: key as Parameters<typeof resolveSupplierBrandPriceStatus>[0][number]["status"] });

test("all applicable Families checked → current", () => {
  assert.equal(resolveSupplierBrandPriceStatus([status("price_checked"), status("price_checked")]).state, "current");
});

test("4 checked, 1 update, 1 needs attention → needs attention, 4 of 6 applicable", () => {
  const summary = resolveSupplierBrandPriceStatus([...Array(4).fill(status("price_checked")), status("update_available"), status("needs_attention")]);
  assert.equal(summary.state, "needs_attention"); assert.equal(summary.applicableFamilies, 6); assert.equal(summary.checkedFamilies, 4);
});

test("one checked and one update available → partially checked, never current", () => {
  assert.equal(resolveSupplierBrandPriceStatus([status("price_checked"), status("update_available")]).state, "partially_checked");
});

test("a partially checked Family keeps the Brand from being current", () => {
  assert.equal(resolveSupplierBrandPriceStatus([status("price_checked"), status("partially_checked")]).state, "partially_checked");
});

test("a no-current-list Family is outside the denominator", () => {
  const summary = resolveSupplierBrandPriceStatus([status("price_checked"), status("no_price_list")]);
  assert.equal(summary.applicableFamilies, 1); assert.equal(summary.noPriceListFamilies, 1); assert.equal(summary.state, "current");
});

test("a legacy Family is outside the Supplier denominator", () => {
  const summary = resolveSupplierBrandPriceStatus([status("price_checked"), status("legacy_manual")]);
  assert.equal(summary.applicableFamilies, 1); assert.equal(summary.legacyFamilies, 1); assert.equal(summary.state, "current");
});

test("an upcoming-only source does not count as applicable, and is counted as upcoming", () => {
  const summary = resolveSupplierBrandPriceStatus([status("no_price_list")], 1);
  assert.equal(summary.applicableFamilies, 0); assert.equal(summary.upcomingCount, 1);
});

test("multi-source Brand: checked in one source and pending in another aggregates to partially checked", () => {
  const furniture = resolve([responsibility([v("v1")], "def-A", "LAS Furniture")], [fact({ sourceId: "v1" })])[0];
  const chairs = resolve([responsibility([v("c1")], "def-B", "LAS Chairs", "lead")], [])[0];
  const summary = resolveSupplierBrandPriceStatus([furniture, { ...chairs, status: "update_available" }]);
  assert.equal(summary.applicableFamilies, 2); assert.equal(summary.state, "partially_checked");
});

test("shared presentation keeps every Supplier status distinct and gives an upcoming list a visible date", () => {
  const checked = one([responsibility([v("v1")])], [fact({ sourceId: "v1" })]);
  const partial = one([responsibility([v("v1")])], [fact({ sourceId: "v1", totalTargets: 20, resolvedTargets: 17, excludedTargets: 3, fullyChecked: false, partiallyChecked: true })]);
  const attention = one([responsibility([v("v1")])], [openFact({ sourceId: "v1", unresolvedTargets: 1 })]);
  const update = one([responsibility([v("v1")])], []);
  const inReview = one([responsibility([v("v1")])], [openFact({ sourceId: "v1", batchStatus: "matching", unresolvedTargets: 0 })]);
  const ready = one([responsibility([v("v1")])], [openFact({ sourceId: "v1", unresolvedTargets: 0, resolvedTargets: 1 })]);
  const noList = one([responsibility([v("nov", { effective_from: "2026-11-01" })])], []);
  assert.deepEqual([checked, partial, attention, update, inReview, ready, noList].map((item) => supplierFamilyStatusPresentation(item).label), ["Price checked", "Partially checked", "Needs attention", "Price update available", "In review", "Ready to complete", "No current price list"]);
  assert.match(supplierFamilyStatusPresentation(partial).detail, /17 \/ 20 checked · 3 excluded/);
  assert.match(supplierFamilyStatusPresentation(noList).detail, /New price list effective 1 Nov 2026/);
});
