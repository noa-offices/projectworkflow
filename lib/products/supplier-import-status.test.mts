import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupplierImportResult, type ReviewUiState } from "../../components/products/supplier-import-result.js";
import { describeImportedSource, findSourceReviewBatch, type ReplacementVerdict } from "./supplier-replacement.js";

type Row = Record<string, unknown>;
const db = (tables: Record<string, Row[]>) => ({ from: (t: string) => { let list = [...(tables[t] ?? [])]; const api: Record<string, unknown> = { select: () => api, order: () => api, range: () => api, neq: () => api, gt: () => api, eq: (k: string, v: unknown) => { list = list.filter((r) => r[k] === v); return api; }, then: (resolve: (v: unknown) => unknown) => resolve({ data: list, error: null }) }; return api; } }) as unknown as SupabaseClient;
const ver = (over: Row = {}): Row => ({ id: "v1", brand_id: "b1", definition_id: "d1", status: "imported", title: "Chairs October", filename: "c.xlsx", currency: "EUR", basis: "list", effective_from: "2026-10-15", created_at: "2026-10-16T00:00:00Z", stored_rows: 203870, identity_count: 10206, ...over });
const tables = (versions: Row[], batches: Row[] = []) => ({ supplier_source_definitions: [{ id: "d1", brand_id: "b1", name: "LAS Chairs", is_active: true }], supplier_source_versions: versions, supplier_price_batches: batches });
const describe = (versions: Row[], id = "v1") => describeImportedSource(db(tables(versions)), { brandId: "b1", sourceId: id });

test("a finished import reports the stored facts and that it is the current price list", async () => {
  const verdict = await describe([ver(), ver({ id: "old", status: "archived", effective_from: "2026-02-02" })]);
  assert.equal(verdict.status, "current");
  assert.deepEqual(verdict.details, { title: "Chairs October", definitionName: "LAS Chairs", effectiveFrom: "2026-10-15", rows: 203870, identities: 10206 });
  assert.equal(verdict.message, "This is now the current supplier price list for LAS Chairs.");
});
test("a future-dated source is scheduled, never current", async () => {
  const verdict = await describe([ver({ effective_from: "2999-01-01" }), ver({ id: "old", effective_from: "2026-02-02", title: "Earlier" })]);
  assert.equal(verdict.status, "scheduled"); assert.match(verdict.message, /becomes applicable on 2999-01-01.*Earlier stays current/);
});
test("imported but not current explains why", async () => {
  const verdict = await describe([ver({ effective_from: "2026-01-01" }), ver({ id: "newer", effective_from: "2026-09-01", title: "Newer" })]);
  assert.equal(verdict.status, "not_current"); assert.match(verdict.message, /another price list is currently applicable.*Newer.*later effective date/);
});
test("an unfinished or missing import is never described as a success", async () => {
  for (const versions of [[ver({ status: "importing" })], [ver({ status: "failed" })], []]) assert.equal((await describe(versions)).status, "not_imported");
});
test("the verdict is scoped to the source's own supplier price list", async () => {
  const c = db({ ...tables([ver(), ver({ id: "furn", definition_id: "d2", title: "Furniture", effective_from: "2027-01-01" })]), supplier_source_definitions: [{ id: "d1", brand_id: "b1", name: "LAS Chairs", is_active: true }, { id: "d2", brand_id: "b1", name: "LAS Furniture", is_active: true }] });
  assert.equal((await describeImportedSource(c, { brandId: "b1", sourceId: "v1" })).status, "current");   // Furniture's later date does not affect Chairs
});
test("a source without a supplier price list is reported as imported but unlinked", async () => {
  const verdict = await describe([ver({ definition_id: null })]);
  assert.deepEqual([verdict.status, verdict.message], ["unlinked", "Imported successfully."]);
});
test("review lookup: none, existing, and open reviews preferred, so a retry never duplicates", async () => {
  assert.deepEqual(await findSourceReviewBatch(db(tables([ver()])), "v1"), { state: "none", batchId: null, status: null });
  const batches = [{ id: "b-old", source_id: "v1", status: "completed", created_at: "2026-10-17" }, { id: "b-open", source_id: "v1", status: "review", created_at: "2026-10-16" }, { id: "other", source_id: "v2", status: "review", created_at: "2026-10-18" }];
  assert.deepEqual(await findSourceReviewBatch(db(tables([ver()], batches)), "v1"), { state: "exists", batchId: "b-open", status: "review" });
});

// ---- presentation ----
const current: ReplacementVerdict = { status: "current", applicableTitle: "Chairs October", message: "This is now the current supplier price list for LAS Chairs.", details: { title: "Chairs October", definitionName: "LAS Chairs", effectiveFrom: "2026-10-15", rows: 203870, identities: 10206 } };
const render = (verdict: ReplacementVerdict, review: ReviewUiState, over: { existing?: boolean; replaceMode?: boolean } = {}) => renderToStaticMarkup(createElement(SupplierImportResult, { verdict, existing: over.existing ?? false, review, brandId: "b1", sourceId: "v1", replaceMode: over.replaceMode ?? false, onRetryReview() {} }));
test("success section shows the stored facts, the current-version line, and the unchanged-prices note, separately from review", () => {
  const html = render(current, { state: "preparing" });
  for (const text of ["Price List Imported Successfully", "Chairs October", "LAS Chairs", "203,870 rows imported", "10,206 supplier identities", "Effective 15 Oct 2026", "This is now the current supplier price list for LAS Chairs.", "Earlier versions remain in History", "Existing product and quotation prices are unchanged", "Preparing product price review…"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Comparing with your Products|Start Price Review/);
});
test("review ready offers Start Price Review; review failure keeps the success message and offers a retry", () => {
  const ready = render(current, { state: "ready", batchId: "batch-1" });
  assert.ok(ready.includes("Review ready.")); assert.match(ready, /href="[^"]*source=v1&amp;batch=batch-1&amp;view=family">Start Price Review/); assert.ok(ready.includes("Go to Current Price List"));
  const failed = render(current, { state: "failed", error: "timed out" });
  assert.ok(failed.includes("Price List Imported Successfully") && failed.includes("Review preparation failed: timed out") && failed.includes("Retry review")); assert.doesNotMatch(failed, /Start Price Review/);
});
test("scheduled and not-current outcomes are never labelled current; incomplete imports show no success", () => {
  const scheduled = render({ status: "scheduled", applicableTitle: "Earlier", message: "Imported successfully. This price list becomes applicable on 2999-01-01.", details: current.details }, { state: "idle" });
  assert.ok(scheduled.includes("becomes applicable on 2999-01-01")); assert.doesNotMatch(scheduled, /now the current supplier price list/);
  const incomplete = render({ status: "not_imported", applicableTitle: null, message: "The import has not finished." }, { state: "idle" });
  assert.ok(incomplete.includes("Import not finished")); assert.doesNotMatch(incomplete, /Imported Successfully|rows imported/);
});
test("replace mode and same-file reuse keep their own wording and start no review", () => {
  const replaced = render(current, { state: "idle" }, { replaceMode: true });
  assert.ok(replaced.includes("Price list replaced.") && replaced.includes("Return to Current Price List")); assert.doesNotMatch(replaced, /Start Price Review|Product price review/);
  assert.ok(render(current, { state: "idle" }, { existing: true }).includes("No new version was created"));
});

// ---- wiring ----
test("wiring: review starts only after import is described, once; no auto-navigation; cancel/resume/replace flows intact", () => {
  const wizard = readFileSync("components/products/supplier-import-wizard.tsx", "utf8");
  const actions = readFileSync("app/products/price-updates/supplier-sources/actions.ts", "utf8");
  assert.doesNotMatch(wizard, /Comparing with your Products/);
  assert.ok(wizard.indexOf("describeSupplierImport(brandId, result.id)") < wizard.indexOf("await prepareReview(result.id)"));
  assert.match(wizard, /if \(verdict\.status !== "not_imported"\) await prepareReview/);
  assert.doesNotMatch(wizard, /createSupplierReviewBatch/);
  assert.ok(actions.indexOf("findSourceReviewBatch(client, sourceId)") < actions.indexOf('supplierCreateReviewBatch(client, sourceId, "complete", [], undefined)'));
  assert.match(actions, /export async function prepareSupplierSourceReview\(sourceId: string\) \{\r?\n  const \{ client \} = await reviewer\(\);/);
  assert.match(actions, /export async function describeSupplierImport\(brandId: string, sourceId: string\) \{\r?\n  const \{ client \} = await reviewer\(\);/);
  for (const keep of ["Resume Finalization", "Resume Import", "Cancel Import", "Confirm Replacement", "importWithNewSettings"]) assert.ok(wizard.includes(keep), keep);
  assert.equal((wizard.match(/window\.confirm\(/g) ?? []).length, 3);
  const lib = readFileSync("lib/products/supplier-replacement.ts", "utf8");
  assert.doesNotMatch(lib.slice(lib.indexOf("describeImportedSource")), /\.insert\(|\.update\(|\.delete\(|product_templates|quotation/i);   // read-only
  assert.match(readFileSync("components/products/supplier-coverage.tsx", "utf8"), /Product and quotation prices change only when a review is completed/);
});
