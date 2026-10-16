import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { archiveBlockingSource, canOfferReplacement, blockingSourceFromError, loadReplacementContext, previewReplacement, validateReplacementRequest, verifyReplacement } from "./supplier-replacement.js";
import { listSmartSetupSupplierSources } from "./smart-setup-supplier-sources.js";
import { resolveApplicableSupplierSourceVersion } from "./supplier-price-repository.js";

const TODAY = "2026-10-16";
const current: { title: string; effectiveFrom: string | null; currency: string; basis: string } = { title: "LAS October", effectiveFrom: "2026-02-02", currency: "EUR", basis: "list" };
const versions = [{ id: "v-old", effective_from: "2026-02-02", created_at: "2026-02-03T00:00:00Z" }];
const preview = (effectiveFrom: string, over: { currency?: string | null; basis?: string | null; cur?: typeof current | null } = {}) =>
  previewReplacement({ versions, current: over.cur === undefined ? current : over.cur, proposed: { effectiveFrom, currency: over.currency === undefined ? "EUR" : over.currency, basis: over.basis === undefined ? "list" : over.basis }, today: TODAY });

test("preview: a later or equal effective date makes the replacement current; the resolver decides", () => {
  assert.equal(preview("2026-09-01").becomesCurrent, true); assert.match(preview("2026-09-01").headline, /replaces LAS October/);
  assert.equal(preview("2026-02-02").becomesCurrent, true);                     // same date: the newer import wins under the existing rule
  assert.equal(preview(TODAY).becomesCurrent, true);
});
test("preview: an earlier date does not become current and says why", () => {
  const p = preview("2026-01-01"); assert.equal(p.becomesCurrent, false); assert.match(p.headline, /will NOT become current.*2026-02-02/);
});
test("preview: a future date is scheduled, never described as current", () => {
  const p = preview("2026-12-01"); assert.deepEqual([p.becomesCurrent, p.currentFrom], [false, "2026-12-01"]); assert.match(p.headline, /becomes current on 2026-12-01.*stays current/);
});
test("preview: an undated current list is replaced by a dated one", () => {
  assert.equal(preview("2026-03-01", { cur: { ...current, effectiveFrom: null } }).becomesCurrent, true);
});
test("preview: currency change, unknown basis and basis change are called out; a missing date is refused", () => {
  assert.ok(preview("2026-09-01", { currency: "USD" }).warnings.some((w) => /Currency changes from EUR to USD/.test(w)));
  assert.ok(preview("2026-09-01", { basis: "unknown" }).warnings.some((w) => /not set to list or net/.test(w)));
  assert.ok(preview("2026-09-01", { basis: "net" }).warnings.some((w) => /basis changes from list to net/.test(w)));
  assert.match(preview("").headline, /Choose the date/); assert.equal(preview("not-a-date").becomesCurrent, false);
});
test("the duplicate-file conflict is recognised only for the different-profile error", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  assert.equal(blockingSourceFromError(`Supplier source already exists for this Brand and file (${id}). It uses a different import profile; archive it before importing the file again.`), id);
  assert.equal(blockingSourceFromError("Invalid source hash"), null);
});

// ---- fake database ----
type Row = Record<string, unknown>;
function db(tables: Record<string, Row[]>) {
  const writes: Array<{ name: string; args: unknown }> = [];
  const client = {
    from: (table: string) => { let list = [...(tables[table] ?? [])]; const api: Record<string, unknown> = { select: () => api, order: () => api, range: () => api, neq: () => api, gt: () => api, eq: (k: string, v: unknown) => { list = list.filter((r) => r[k] === v); return api; }, then: (resolve: (v: unknown) => unknown) => resolve({ data: list, error: null }) }; return api; },
    rpc: async (name: string, args: unknown) => { writes.push({ name, args }); const a = args as { p_operation?: string; p_payload?: { source_id: string } }; if (name === "supplier_price_review_write" && a.p_operation === "archive_source") { const s = (tables.supplier_source_versions ?? []).find((r) => r.id === a.p_payload!.source_id); if (s) s.status = "archived"; } return { data: {}, error: null }; },
  } as unknown as SupabaseClient;
  return { client, writes };
}
const ver = (over: Row = {}): Row => ({ id: "v1", brand_id: "b1", definition_id: "d1", status: "imported", title: "LAS October", filename: "las.csv", currency: "EUR", basis: "list", file_hash: "h", effective_from: "2026-02-02", created_at: "2026-02-03T00:00:00Z", received_at: null, ...over });
const tables = (versionRows: Row[]) => ({ brands: [{ id: "b1" }, { id: "b2" }], supplier_source_definitions: [{ id: "d1", brand_id: "b1", name: "LAS Chairs", is_active: true }, { id: "d2", brand_id: "b2", name: "Other", is_active: true }, { id: "d3", brand_id: "b1", name: "Furniture", is_active: true }], supplier_source_versions: versionRows });

test("definition ownership: another Brand's definition and a bad date are rejected before any import", async () => {
  const f = db(tables([ver()]));
  assert.equal((await validateReplacementRequest(f.client, { brandId: "b1", definitionId: "d1", effectiveFrom: "2026-09-01" })).definitionName, "LAS Chairs");
  await assert.rejects(validateReplacementRequest(f.client, { brandId: "b1", definitionId: "d2", effectiveFrom: "2026-09-01" }), /unavailable for this Brand/);
  await assert.rejects(validateReplacementRequest(f.client, { brandId: "b1", definitionId: "d1", effectiveFrom: "" }), /Choose the date/);
  assert.deepEqual(f.writes, []);
});
test("replacement is scoped to the definition: other price lists of the same Brand are not considered", async () => {
  const f = db(tables([ver(), ver({ id: "v-furn", definition_id: "d3", effective_from: "2026-10-01", title: "Furniture" })]));
  const context = await loadReplacementContext(f.client, { brandId: "b1", definitionId: "d1" });
  assert.deepEqual([context.applicable?.id, context.versions.map((v) => v.id)], ["v1", ["v1"]]);
});

test("same file, different settings: the blocking source is archived after server-side checks, with its history kept", async () => {
  const rows = [ver(), ver({ id: "v-other", file_hash: "x", definition_id: "d3" })]; const f = db(tables(rows));
  const result = await archiveBlockingSource(f.client, { brandId: "b1", sourceId: "v1", fileHash: "h" });
  assert.deepEqual([result.title, result.wasCurrent, result.alreadyArchived], ["LAS October", true, false]);   // it was current: the caller warns
  assert.equal(rows[0].status, "archived"); assert.equal(rows[1].status, "imported");                           // nothing else touched
  assert.deepEqual(f.writes.map((w) => (w.args as { p_operation: string }).p_operation), ["archive_source"]);    // archive only: no purge, no deletion, no price write
  assert.equal((await archiveBlockingSource(f.client, { brandId: "b1", sourceId: "v1", fileHash: "h" })).alreadyArchived, true); // repeat is safe
});
test("archive is refused for another Brand's source or a different file hash", async () => {
  const f = db(tables([ver({ brand_id: "b2", definition_id: "d2" }), ver({ id: "v2", file_hash: "other" })]));
  await assert.rejects(archiveBlockingSource(f.client, { brandId: "b1", sourceId: "v1", fileHash: "h" }), /unavailable for this Brand/);
  await assert.rejects(archiveBlockingSource(f.client, { brandId: "b1", sourceId: "v2", fileHash: "h" }), /unavailable for this Brand/);
  assert.deepEqual(f.writes, []);
});
test("archiving a source that is not current does not claim it was", async () => {
  const f = db(tables([ver({ effective_from: "2026-01-01" }), ver({ id: "v-new", effective_from: "2026-09-01", file_hash: "n" })]));
  assert.equal((await archiveBlockingSource(f.client, { brandId: "b1", sourceId: "v1", fileHash: "h" })).wasCurrent, false);
});

test("after the import the verdict is honest: current, scheduled, not current, or not imported", async () => {
  const base = [ver()];
  const verdict = (rows: Row[], sourceId: string) => verifyReplacement(db(tables(rows)).client, { brandId: "b1", definitionId: "d1", sourceId });
  assert.equal((await verdict([...base, ver({ id: "v2", title: "New", effective_from: "2026-09-01", created_at: "2026-10-01T00:00:00Z" })], "v2")).status, "current");
  assert.equal((await verdict([...base, ver({ id: "v2", title: "New", effective_from: "2027-01-01" })], "v2")).status, "scheduled");
  assert.equal((await verdict([...base, ver({ id: "v2", title: "New", effective_from: "2026-01-01" })], "v2")).status, "not_current");
  assert.equal((await verdict([...base, ver({ id: "v2", status: "importing" })], "v2")).status, "not_imported");
  assert.equal((await verdict([...base, ver({ id: "v2", definition_id: "d3" })], "v2")).status, "not_imported");   // wrong definition
});
test("the resolver and Smart Setup both select the replacement; the old version is retained", async () => {
  const rows = [ver(), ver({ id: "v2", title: "New", file_hash: "n", effective_from: "2026-09-01", created_at: "2026-10-01T00:00:00Z" })];
  assert.equal(resolveApplicableSupplierSourceVersion(rows as never, TODAY)?.id, "v2");
  const f = db(tables(rows));
  const list = await listSmartSetupSupplierSources({ getProfile: async () => ({ role: "system_owner", account_status: "active" }), getClient: async () => f.client }, "b1");
  assert.deepEqual(list.status === "ok" ? list.sources.map((s) => [s.definitionId, s.versionId]) : null, [["d1", "v2"]]);
  assert.equal(rows.length, 2); assert.equal(rows[0].status, "imported");                         // v1 is superseded by date, not removed or archived
});

test("wiring: reviewer/approver gates, no price writes, one confirmation, honest success, Manage Previous Versions", () => {
  const actions = readFileSync("app/products/price-updates/supplier-sources/actions.ts", "utf8");
  assert.match(actions, /export async function validateSupplierReplacement\(brandId: string, definitionId: string, effectiveFrom: string, fileHash\?: string\) \{\r?\n  const \{ client \} = await reviewer\(\);/);
  assert.match(actions, /export async function archiveBlockingSupplierSource\([^)]*\) \{\r?\n  const \{ client \} = await approver\(\);/);
  assert.match(actions, /export async function verifySupplierReplacement\([^)]*\) \{\r?\n  const \{ client \} = await reviewer\(\);/);
  const lib = readFileSync("lib/products/supplier-replacement.ts", "utf8");
  assert.doesNotMatch(lib, /supplierApplyReviewedPrice|purge_|product_templates|\.insert\(|\.delete\(|\.update\(/);
  const wizard = readFileSync("components/products/supplier-import-wizard.tsx", "utf8");
  const result = readFileSync("components/products/supplier-import-result.tsx", "utf8");
  assert.match(wizard, /Confirm Replacement/); assert.match(result, /Manage Previous Versions/); assert.match(result, /Return to Current Price List/);
  assert.match(wizard, /setStep\(replace \? 5 : 4\)/);                                              // Families are not asked again
  const replaceBranch = wizard.slice(wizard.indexOf("if (replace) {\n        // Success"), wizard.indexOf("const before = new Set"));
  assert.match(replaceBranch, /verifySupplierReplacement\(/); assert.doesNotMatch(replaceBranch, /createSupplierReviewBatch|confirmSupplierCoverage/);
  assert.ok(wizard.indexOf("verifySupplierReplacement(brandId") < wizard.indexOf("setReplaced({"));
  assert.match(result, /No new version was created: this file was already imported with the same settings/);
  assert.equal((wizard.match(/window\.confirm\(/g) ?? []).length, 3);
  assert.match(wizard, /supplierImportChunks\(importRows, 500, 600_000, stored\)/);                // importer and chunking unchanged
  const page = readFileSync("app/products/price-updates/supplier-sources/page.tsx", "utf8");
  assert.match(page, /replaceHref: card\.definitionId \? href\(\{ tab: "import", replace: card\.definitionId/);
});

test("the Replace Price List action is offered for current lists and lists with a review in progress, to approvers, with a definition", () => {
  const href = "/products/price-updates/supplier-sources?brand=b1&tab=import&replace=d1";
  assert.equal(canOfferReplacement(true, href, "current"), true);
  assert.equal(canOfferReplacement(true, href, "update_in_progress"), true);        // an open review does not hide it
  assert.equal(canOfferReplacement(true, href, undefined), true);                   // cards without an explicit state are current
  assert.equal(canOfferReplacement(false, href, "current"), false);                 // unauthorized role
  assert.equal(canOfferReplacement(true, "", "current"), false);                    // no supplier price list (definition) behind the card
  assert.equal(canOfferReplacement(true, undefined, "update_in_progress"), false);
  assert.equal(canOfferReplacement(true, href, "upcoming"), false);                 // not yet applicable lists are not the one being replaced
});
test("wiring: the card shows one visible action, the page links every card's definition, the wizard receives it, review actions are intact", () => {
  const card = readFileSync("components/products/supplier-coverage.tsx", "utf8");
  const page = readFileSync("app/products/price-updates/supplier-sources/page.tsx", "utf8");
  assert.equal((card.match(/Replace Price List/g) ?? []).length, 1);                // no duplicate entry in the menu
  assert.match(card, /canOfferReplacement\(approver, item\.replaceHref, item\.priceListState\) \? <Link href=\{item\.replaceHref!\}/);
  assert.match(card, /<Link href=\{item\.openHref\} className=\{primary\}>\{action\}<\/Link>/);   // existing primary review action unchanged
  assert.match(card, /<SupplierLeaveReviewButton batchId=\{item\.batchId\} \/>/);
  for (const label of ["View extracted data", "Edit coverage", "Price list details", "Advanced tools"]) assert.ok(card.includes(label), label);
  assert.match(page, /replaceHref: card\.definitionId \? href\(\{ tab: "import", replace: card\.definitionId, setup: "" \}\) : ""/);
  assert.match(page, /replace: ""/);                                                // ordinary Import/Current tabs do not carry the replace mode
  assert.match(page, /definitionId: replaceDefinitionId, definitionName/);          // the wizard gets exactly the requested definition
  assert.match(readFileSync("components/products/supplier-import-wizard.tsx", "utf8"), /useState\(replace\?\.definitionId \?\? ""\)/);
});
