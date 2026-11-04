import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSupplierCleanup, cleanupCurrentSources, cleanupSummary, deleteListDialog, deletedListMessage, protectedReason, type CleanupBatch, type CleanupVerdict, type CleanupVersion } from "./supplier-cleanup.js";

const day = "2026-11-04";
const version = (id: string, created: string, extra: Partial<CleanupVersion> = {}): CleanupVersion => ({ id, definition_id: "d1", title: `List ${id}`, filename: `${id}.xlsx`, status: "imported", effective_from: null, created_at: `${created}T08:00:00Z`, stored_rows: 100, ...extra });
const verdict = (id: string, current: string, extra: Partial<CleanupVerdict> = {}): CleanupVerdict => ({ source_id: id, current_source_id: current, batches: 1, protected_reviews: [], reasons: [], safe_to_delete: true, rows: 2702, ...extra });

// Interstuhl today: a CSV list (26 Oct, no review), an Excel list (30 Oct, review open) and the latest Excel list (31 Oct, review open).
const versions = [version("csv", "2026-10-26", { filename: "old.csv", stored_rows: 1626 }), version("x30", "2026-10-30", { stored_rows: 2702 }), version("x31", "2026-10-31", { stored_rows: 3133 })];
const batches: CleanupBatch[] = [{ id: "b30", source_id: "x30", status: "review" }, { id: "b31", source_id: "x31", status: "review" }];
const definitions = [{ id: "d1", name: "Interstuhl", isActive: true, canDelete: false, familyCount: 3 }, { id: "d2", name: "Interstuhl every", isActive: true, canDelete: true, familyCount: 0 }, { id: "d3", name: "LAS Chairs", isActive: true, canDelete: true, familyCount: 0 }];
const verdicts = new Map([["x31", [verdict("x30", "x31", { rows: 2702 }), verdict("csv", "x31", { rows: 1626 })]]]);
const build = (extra: Partial<Parameters<typeof buildSupplierCleanup>[0]> = {}) => buildSupplierCleanup({ versions, batches, definitions, verdicts, businessDate: day, ...extra });

test("the newest applicable list is current and never appears as removable", () => {
  assert.equal(cleanupCurrentSources(versions, day).get("d1")?.id, "x31");
  const cleanup = build();
  assert.deepEqual(cleanup.oldLists.map((item) => item.id).sort(), ["csv", "x30"]);
  assert.ok(!cleanup.oldLists.some((item) => item.id === "x31"));
  assert.ok(!cleanup.staleReviews.some((item) => item.sourceId === "x31")); // the current list's review is never touched
});

test("old lists show file, import date, line count and a plain reason", () => {
  const csv = build().oldLists.find((item) => item.id === "csv")!;
  assert.equal(csv.filename, "old.csv"); assert.equal(csv.importedOn, "2026-10-26"); assert.equal(csv.lines, 1626);
  assert.equal(csv.removable, true); assert.match(csv.reason, /^Safe to delete/); assert.equal(csv.currentSourceId, "x31");
  const x30 = build().oldLists.find((item) => item.id === "x30")!;
  assert.match(x30.reason, /Its open review is deleted with it/);
});

test("protected lists show the plain reason from the database check", () => {
  const protectedVerdicts = new Map([["x31", [verdict("x30", "x31", { safe_to_delete: false, reasons: ["This previous price list contains review history that must be retained."], protected_reviews: ["KEEP_PROTECTED_COMPLETED", "KEEP_PROTECTED_APPLIED"] }), verdict("csv", "x31")]]]);
  const x30 = build({ verdicts: protectedVerdicts }).oldLists.find((item) => item.id === "x30")!;
  assert.equal(x30.removable, false);
  assert.match(x30.reason, /used in completed price history/); assert.match(x30.reason, /Product history/);
  assert.equal(protectedReason({ reasons: ["Not an older version"], protected_reviews: [] }), "It is not older than the current price list.");
});

test("a list of a completed review stays protected even with a newer list", () => {
  const withBaseline = build({ batches: [...batches, { id: "bc", source_id: "csv", status: "completed" }] });
  const csv = withBaseline.oldLists.find((item) => item.id === "csv")!;
  assert.equal(csv.removable, false); assert.match(csv.reason, /completed review/);
});

test("lists with no Supplier source, or no current list, are protected with a reason", () => {
  const loose = build({ versions: [...versions, version("loose", "2026-10-20", { definition_id: null }), version("loose-new", "2026-10-25", { definition_id: null })] });
  const item = loose.oldLists.find((entry) => entry.id === "loose")!;
  assert.ok(!loose.oldLists.some((entry) => entry.id === "loose-new")); // the newest of the unlinked lists is its own current list
  assert.equal(item.removable, false); assert.match(item.reason, /not linked to a Supplier source/); assert.equal(item.currentSourceId, null);
});

test("upcoming and unfinished lists are not offered", () => {
  const cleanup = build({ versions: [...versions, version("future", "2026-10-31", { effective_from: "2027-01-01" }), version("half", "2026-10-29", { status: "importing" })] });
  assert.ok(!cleanup.oldLists.some((item) => ["future", "half"].includes(item.id)));
});

test("stale reviews are open reviews on lists that are not current", () => {
  const stale = build().staleReviews;
  assert.deepEqual(stale.map((item) => item.batchId), ["b30"]);
  assert.equal(stale[0].statusLabel, "Open");
  assert.equal(build({ batches: [{ id: "bm", source_id: "x30", status: "matching" }] }).staleReviews[0].statusLabel, "Matching");
  assert.equal(build({ batches: [{ id: "ba", source_id: "x30", status: "abandoned" }, { id: "bd", source_id: "x30", status: "completed" }] }).staleReviews.length, 0);
});

test("unused definitions have no price list and no products", () => {
  assert.deepEqual(build().unusedDefinitions.map((item) => item.name), ["Interstuhl every", "LAS Chairs"]);
  assert.equal(build({ definitions: [{ id: "d9", name: "Has products", isActive: true, canDelete: true, familyCount: 2 }, { id: "d8", name: "Has list", isActive: true, canDelete: false, familyCount: 0 }] }).unusedDefinitions.length, 0);
});

test("the summary line and the empty state", () => {
  assert.equal(cleanupSummary(build()), "2 old lists, 1 stale review, 2 unused definitions can be cleaned up");
  assert.equal(cleanupSummary({ oldLists: [], staleReviews: [], unusedDefinitions: [] }), "Nothing to clean up");
  const one = build({ versions: [versions[2]], batches: [], definitions: [] });
  assert.equal(cleanupSummary(one), "Nothing to clean up");
  const single = build({ versions: [versions[0], versions[2]], batches: [], definitions: [{ id: "d2", name: "x", isActive: true, canDelete: true, familyCount: 0 }], verdicts: new Map([["x31", [verdict("csv", "x31")]]]) });
  assert.equal(cleanupSummary(single), "1 old list, 1 unused definition can be cleaned up");
  const protectedOnly = build({ verdicts: new Map([["x31", [verdict("x30", "x31", { safe_to_delete: false, reasons: ["Not an older version"] }), verdict("csv", "x31", { safe_to_delete: false, reasons: ["Not an older version"] })]]]), batches: [], definitions: [] });
  assert.equal(cleanupSummary(protectedOnly), "Nothing to clean up");
});

test("the confirm text names what is removed and what is kept; the result is in plain words", () => {
  const dialog = deleteListDialog({ title: "Interstuhl 30 Oct", filename: "x.xlsx", importedOn: "2026-10-30", lines: 2702, openReviews: 1 });
  assert.match(dialog.removes.join(" "), /2702 lines/);
  assert.match(dialog.removes.join(" "), /1 open review/);
  assert.match(dialog.keeps.join(" "), /Product price history/); assert.match(dialog.keeps.join(" "), /prices already applied/i);
  assert.equal(deletedListMessage({ supplier_source_rows: 4431 }), "Deleted 1 old price list. 4,431 lines removed.");
});

test("the page shows the Clean up tab only on the coded Brand screen and the loader never writes", () => {
  const page = readFileSync(new URL("../../app/products/price-updates/supplier-sources/page.tsx", import.meta.url), "utf8");
  assert.ok(page.indexOf("if (brand && manualBrandState)") < page.indexOf("<SupplierCleanupPanel")); // a manual Brand returns before the tabs
  const loader = readFileSync(new URL("./supplier-cleanup-loader.ts", import.meta.url), "utf8");
  assert.doesNotMatch(loader, /supplierDelete|\.delete\(|\.update\(|\.insert\(|dry_run: false|supplierWrite/);
});
