import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkImportFile, defaultListTitle, importDestination, linkNeedsReplacement, openReviewConflict, planReplacement, previousListsLine, replacementConfirmText, selectLiveCards, type LiveBatch, type LiveVersion } from "./supplier-live-list.js";

const day = "2026-11-04";
const v = (id: string, created: string, extra: Partial<LiveVersion> = {}): LiveVersion => ({ id, definition_id: "d1", title: `List ${id}`, filename: `${id}.xlsx`, file_hash: `hash-${id}`, status: "imported", effective_from: null, created_at: `${created}T08:00:00Z`, ...extra });
// Interstuhl today: three lists in one source.
const interstuhl = [v("csv", "2026-10-26", { filename: "old.csv", title: "INTERSTUHL price list" }), v("x30", "2026-10-30", { filename: "price.xlsx", file_hash: "h30" }), v("x31", "2026-10-31", { filename: "price.xlsx", file_hash: "h31", title: "INTERSTUHL price list (31 Oct)", effective_from: "2026-10-31" })];
const batches: LiveBatch[] = [{ id: "b30", source_id: "x30", status: "review" }, { id: "b31", source_id: "x31", status: "review" }];

test("a source that already has a live list is replaced, never added to", () => {
  const result = importDestination(interstuhl, "d1", day);
  assert.equal(result.kind, "replace");
  assert.equal(result.kind === "replace" && result.replaces.id, "x31"); // the current one by effective date
  assert.equal(result.kind === "replace" && result.message, "This will replace INTERSTUHL price list (31 Oct) (effective 31 Oct 2026).");
  assert.equal(importDestination(interstuhl, "d2", day).kind, "new_list"); // a different Supplier source of the same Brand
  assert.equal(importDestination(interstuhl, null, day).kind, "new_list");
  assert.equal(importDestination(interstuhl.map((item) => ({ ...item, status: "archived" })), "d1", day).kind, "new_list");
});

test("an undated list reads as effective immediately; an upcoming list is not the one replaced when a current one exists", () => {
  const undated = importDestination([v("a", "2026-10-01")], "d1", day);
  assert.equal(undated.kind === "replace" && undated.message, "This will replace List a (effective immediately).");
  const withUpcoming = importDestination([v("now", "2026-10-01"), v("later", "2026-10-20", { effective_from: "2027-01-01" })], "d1", day);
  assert.equal(withUpcoming.kind === "replace" && withUpcoming.replaces.id, "now");
});

test("linking a new list into a source with a live list needs the replacement, unless it is already linked", () => {
  const fresh = { id: "new", definition_id: null };
  assert.equal(linkNeedsReplacement({ versions: interstuhl, source: fresh, definitionId: "d1" }).kind, "replace");
  assert.equal(linkNeedsReplacement({ versions: interstuhl, source: { id: "x31", definition_id: "d1" }, definitionId: "d1" }).kind, "new_list"); // a retry of the same import
  assert.equal(linkNeedsReplacement({ versions: interstuhl, source: fresh, definitionId: "d2" }).kind, "new_list");
  assert.equal(linkNeedsReplacement({ versions: interstuhl, source: fresh, definitionId: null }).kind, "new_list");
});

test("when the replacement is current, the older lists are archived and their reviews closed; a completed baseline stays", () => {
  const plan = planReplacement({ versions: interstuhl, batches, definitionId: "d1", newList: { id: "new", effective_from: "2026-11-04", created_at: "2026-11-04T08:00:00Z" }, businessDate: day });
  assert.equal(plan.becomesCurrent, true);
  assert.deepEqual(plan.archive.map((item) => item.id).sort(), ["csv", "x30", "x31"]);
  assert.deepEqual(plan.leaveReviews.map((item) => item.batchId).sort(), ["b30", "b31"]);
  const withBaseline = planReplacement({ versions: interstuhl, batches: [...batches, { id: "bc", source_id: "csv", status: "completed" }], definitionId: "d1", newList: { id: "new", effective_from: "2026-11-04", created_at: "2026-11-04T08:00:00Z" }, businessDate: day });
  assert.ok(!withBaseline.archive.some((item) => item.id === "csv")); assert.match(withBaseline.kept[0].reason, /baseline of a completed review/);
  assert.match(replacementConfirmText(plan).join(" "), /Product history are not changed/);
});

test("an upcoming replacement changes nothing yet; a replacement that is not current does not archive", () => {
  const upcoming = planReplacement({ versions: interstuhl, batches, definitionId: "d1", newList: { id: "new", effective_from: "2027-02-01", created_at: "2026-11-04T08:00:00Z" }, businessDate: day });
  assert.equal(upcoming.becomesCurrent, false); assert.equal(upcoming.archive.length, 0); assert.equal(upcoming.leaveReviews.length, 0);
  const older = planReplacement({ versions: interstuhl, batches, definitionId: "d1", newList: { id: "new", effective_from: "2026-01-01", created_at: "2026-11-04T08:00:00Z" }, businessDate: day });
  assert.equal(older.becomesCurrent, false); assert.equal(older.archive.length, 0);
});

test("a future-dated older list stays as upcoming when a newer list becomes current", () => {
  const plan = planReplacement({ versions: [v("now", "2026-10-01"), v("later", "2026-10-02", { effective_from: "2027-03-01" })], batches: [], definitionId: "d1", newList: { id: "new", effective_from: "2026-11-01", created_at: "2026-11-04T08:00:00Z" }, businessDate: day });
  assert.deepEqual(plan.archive.map((item) => item.id), ["now"]); assert.equal(plan.kept[0].id, "later");
});

test("one open review per Supplier source", () => {
  assert.match(openReviewConflict({ versions: interstuhl, batches, sourceId: "x31" }) ?? "", /already has an open review for this Supplier source/);
  assert.equal(openReviewConflict({ versions: interstuhl, batches: [{ id: "b31", source_id: "x31", status: "review" }], sourceId: "x31" }), null); // its own review is not a conflict
  assert.equal(openReviewConflict({ versions: [...interstuhl, v("other", "2026-10-31", { definition_id: "d2" })], batches, sourceId: "other" }), null); // another source of the Brand
  assert.equal(openReviewConflict({ versions: interstuhl.map((item) => item.id === "x30" ? { ...item, status: "archived" } : item), batches: [{ id: "b30", source_id: "x30", status: "review" }], sourceId: "x31" }), null); // an archived list does not count
  assert.equal(openReviewConflict({ versions: interstuhl, batches: [{ id: "bm", source_id: "x30", status: "matching" }], sourceId: "x31" }) === null, false);
});

test("same file and same name messages", () => {
  const exact = checkImportFile({ versions: interstuhl, fileHash: "h31", fileName: "other-name.xlsx" });
  assert.equal(exact.exact?.message, "This exact file was already imported on 31 Oct 2026.");
  const sameName = checkImportFile({ versions: interstuhl, fileHash: "new-hash", fileName: "PRICE.xlsx" });
  assert.equal(sameName.exact, null);
  assert.equal(sameName.sameName?.message, "A file with this name was imported on 31 Oct 2026, but its content is different.");
  const none = checkImportFile({ versions: interstuhl, fileHash: "x", fileName: "fresh.xlsx" });
  assert.equal(none.exact, null); assert.equal(none.sameName, null);
  assert.equal(checkImportFile({ versions: interstuhl.map((item) => ({ ...item, status: "archived" })), fileHash: "h31", fileName: "a" }).exact, null);
});

test("the default list title uses the file name and the effective date", () => {
  assert.equal(defaultListTitle("INTERSTUHL price view.xlsx", "2026-01-02"), "INTERSTUHL price view, effective 2 Jan 2026");
  assert.equal(defaultListTitle("price_list_final.csv", ""), "price list final");
  assert.equal(defaultListTitle("", "2026-01-02"), null);
});

test("one card per Supplier source: two sources of one Brand give two cards, two lists of one source give one", () => {
  const card = (sourceId: string, definitionId: string | null, state: string, created: string, effective: string | null = null) => ({ sourceId, definitionId, priceListState: state, createdAt: created, effectiveFrom: effective });
  const two = selectLiveCards([card("a1", "chairs", "update_in_progress", "2026-10-30"), card("b1", "desks", "update_in_progress", "2026-10-31")]);
  assert.deepEqual(two.shown.map((item) => item.sourceId).sort(), ["a1", "b1"]);
  const one = selectLiveCards([card("x30", "d1", "update_in_progress", "2026-10-30"), card("x31", "d1", "update_in_progress", "2026-10-31")]);
  assert.deepEqual(one.shown.map((item) => item.sourceId), ["x31"]); assert.equal(one.hidden.get("d1"), 1);
  const inProgressWins = selectLiveCards([card("base", "d1", "current", "2026-10-01"), card("inc", "d1", "update_in_progress", "2026-10-30")]);
  assert.deepEqual(inProgressWins.shown.map((item) => item.sourceId), ["inc"]);
  const upcoming = selectLiveCards([card("cur", "d1", "current", "2026-10-01"), card("up1", "d1", "upcoming", "2026-10-02", "2027-01-01"), card("up2", "d1", "upcoming", "2026-10-03", "2027-02-01")]);
  assert.deepEqual(upcoming.shown.map((item) => item.sourceId).sort(), ["cur", "up2"]); // the pending replacement keeps one card
  assert.equal(selectLiveCards([card("loose1", null, "current", "a"), card("loose2", null, "current", "b")]).shown.length, 2); // lists with no source are not grouped
  assert.equal(previousListsLine(1), "1 previous list"); assert.equal(previousListsLine(2), "2 previous lists");
});

test("the server actions enforce the rule, so it cannot be skipped by calling them directly", () => {
  const actions = readFileSync(new URL("../../app/products/price-updates/supplier-sources/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /await assertLinkAllowed\(client, sourceId, definitionId, options\.replaceConfirmed === true\)/);
  assert.equal((actions.match(/await assertNoOtherOpenReview\(client, sourceId\)/g) ?? []).length, 2); // createSupplierReviewBatch and prepareSupplierSourceReview
  assert.match(actions, /assertFileNotAlreadyImported\(client, \{/);
  assert.match(actions, /export async function completeSupplierReplacement\(newSourceId: string, confirmed: boolean\) \{\r?\n  const \{ client \} = await approver\(\);/);
  const server = readFileSync(new URL("./supplier-live-list-server.ts", import.meta.url), "utf8");
  assert.match(server, /if \(input\.confirmed !== true\) throw Error/);
  assert.doesNotMatch(server, /\.delete\(|purge_archived|cleanup_previous/); // archive and leave review only; nothing is deleted
});
