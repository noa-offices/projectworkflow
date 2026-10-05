import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const pageSource = await read("../../app/products/price-updates/supplier-sources/page.tsx");

async function load<T>(path: string, dependencies: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(path, import.meta.url);
  const output = ts.transpileModule(await read(path), { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    return createRequire(url)(name.startsWith("@/") ? fileURLToPath(new URL(`../../${name.slice(2)}`, import.meta.url)) : name);
  }, compiled, compiled.exports);
  return compiled.exports as T;
}
const link = { default: ({ children, ...props }: { href: string; children: unknown; className?: string }) => React.createElement("a", props, children as never) };
const common = {
  "next/link": link, "next/navigation": { useRouter() { return { refresh() {}, push() {} }; } },
  "@/lib/supabase/client": { createClient() { assert.fail("Rendering must not create a database client."); } }, "@/app/products/price-updates/supplier-sources/actions": {},
};
type Component = (props: Record<string, unknown>) => React.ReactElement | null;
const controls = await load<Record<"SupplierImportCard" | "SupplierAdvancedImportSettings" | "SupplierStartReview" | "SupplierCompletionControls", Component>>("./supplier-price-workspace-controls.tsx", common);
const inspector = { SupplierSourceInspector: () => React.createElement("button", { type: "button" }, "View extracted data") };
const workflow = await load<Record<"SupplierWorkflowHeader" | "SupplierImportSummary" | "SupplierImportDetails" | "SupplierTabs" | "SupplierCurrentPriceList" | "SupplierHistoryTable" | "SupplierFinishScreen" | "SupplierCompleteSummary", Component>>("./supplier-price-workflow.tsx", { "next/link": link, "@/components/products/supplier-source-inspector": inspector });
const html = (component: Component, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(component as never, props as never));

const profile = (id: string, title: string) => ({ id, title, config: { full_code_column: "CODE", strategy: "exact", currency: "EUR", basis: "list", price_columns: [{ column: "PRICE", price_field: "unit_price" }] } });
const source = { id: "s1", brand_id: "b", title: "LAS MOBILI — February 2026", filename: "las.xlsx", file_hash: "a".repeat(64), source_type: "xlsx", currency: "EUR", basis: "list", status: "imported", stored_rows: 46108, stored_cells: 46108, identity_count: 3479, expected_rows: 46108, effective_from: "2026-02-01", received_at: null, original_reference: null };
const batch = { id: "r1", brand_id: "b", source_id: "s1", scope: "complete", status: "review", selected_template_ids: [], basis_warning: "", title: "Review" };
const importProps = { brandId: "b", brandName: "LAS MOBILI", suggestedTitle: "LAS MOBILI — February 2026", advancedHref: "/x?advanced=1#advanced", setupHref: "/x?setup=1" };
const advancedProps = { brandId: "b", brandName: "LAS MOBILI", basis: "list", approver: true, templates: [{ id: "t", template_name: "Screen" }], dimensions: [] };

test("Import step: one simple card, auto-selected import profile, no technical tools", () => {
  const one = html(controls.SupplierImportCard, { ...importProps, profiles: [profile("p1", "LAS standard price list")] });
  for (const text of ["Import Supplier Price List", "LAS standard price list", "Ready", "Price list file", "Price list name", "Currency", "Price basis", "Received date (optional)", "Effective date (optional)", "Import price list", "LAS MOBILI — February 2026"]) assert.ok(one.includes(text), text);
  assert.doesNotMatch(one, /<textarea/); assert.doesNotMatch(one, /Profile JSON|canonical|vocabulary|Stored group|full_code_column/i);
  assert.match(one, /<span[^>]*>EUR<\/span>/); assert.match(one, /<span[^>]*>List<\/span>/);
  assert.doesNotMatch(one, /<select(?![^>]*aria-label="Supplier source")/); // the Supplier source choice is separate from the import profile; // one obvious format needs no choice
  const many = html(controls.SupplierImportCard, { ...importProps, profiles: [profile("p1", "LAS standard price list"), profile("p2", "LAS alternate")] });
  assert.match(many, /<select[^>]*>[\s\S]*Choose import profile[\s\S]*LAS alternate/);
  const none = html(controls.SupplierImportCard, { ...importProps, profiles: [] });
  assert.match(none, /This Brand needs an import profile before price lists can be imported\./); assert.match(none, /Set up import profile/); assert.match(none, /href="\/x\?setup=1"/);
  assert.doesNotMatch(none, /type="file"/);
});

test("Advanced import settings hold the technical tools, collapsed unless asked; non-approvers never see them", () => {
  const closed = html(controls.SupplierAdvancedImportSettings, advancedProps);
  assert.match(closed, /<details id="advanced"(?![^>]*open)[^>]*>/); assert.match(closed, /Advanced import settings/);
  for (const text of ["Profile JSON", "Brand dimension vocabulary", "Canonical dimension code", "Explicit finish-code set", "Stored group ID", "full_code_column", "Save profile"]) assert.ok(closed.includes(text), text);
  assert.match(html(controls.SupplierAdvancedImportSettings, { ...advancedProps, open: true }), /<details id="advanced" open=""/);
  assert.equal(html(controls.SupplierAdvancedImportSettings, { ...advancedProps, approver: false }), "");
});

test("steps read Import → Family Review → Complete and the current source is shown once, clearly", () => {
  const header = (step: number, extra: Record<string, unknown> = {}) => html(workflow.SupplierWorkflowHeader, { brandName: "LAS MOBILI", source, batch, step, links: { steps: ["/1", "/2", "/3"], history: "#history", advanced: "#advanced" }, ...extra });
  const two = header(2);
  assert.ok(two.indexOf("1 Import") < two.indexOf("2 Family Review") && two.indexOf("2 Family Review") < two.indexOf("3 Complete"));
  assert.match(two, /aria-current="step"[^>]*>[\s\S]*2 Family Review/); assert.match(two, /\(done\)/); assert.match(two, /\(not started\)/);
  assert.match(two, />LAS MOBILI — February 2026<\/h2>/); assert.match(two, /EUR · List · Imported · Complete Brand Review/); assert.match(two, /Price list history/); assert.match(two, /Advanced tools/);
  assert.equal((two.match(/February 2026/g) ?? []).length, 1);
  const first = header(1, { source: undefined, batch: undefined }); // no source yet: later steps are not links
  assert.doesNotMatch(first, /href="\/2"/); assert.match(first, /<span[^>]*>[\s\S]*2 Family Review/);
  assert.match(header(3), /aria-current="step"[^>]*>[\s\S]*3 Complete/);
});

test("Import summary shows friendly results and only actionable warnings; details stay one click away", () => {
  const summary = html(workflow.SupplierImportSummary, { brandName: "LAS MOBILI", source, families: 6, warnings: 1, continueHref: "/review", detailsHref: "/details" });
  for (const text of ["Imported successfully", "46,108", "3,479", "EUR", "List prices", "6 Product families found", "1 source-data issue", "Continue to Family Review", "View import details"]) assert.ok(summary.includes(text), text);
  assert.doesNotMatch(summary, /SHA-256|hash|commercial identit|provenance/i);
  assert.doesNotMatch(html(workflow.SupplierImportSummary, { brandName: "LAS MOBILI", source, families: 6, warnings: 0, continueHref: "/r", detailsHref: "/d" }), /source-data issue/);
  const details = html(workflow.SupplierImportDetails, { source, workingFileUrl: "https://example.test/file" });
  assert.match(details, /SHA-256 a{64}/); assert.match(details, /Commercial identities/); assert.match(details, /Download retained working source/);
});


test("Start Review is the entry to Step 2 with Complete Brand as the recommended default", () => {
  const start = html(controls.SupplierStartReview, { brandId: "b", sourceId: "s1", templates: [{ id: "t", template_name: "Screen" }] });
  assert.match(start, /Start Review/); assert.match(start, /<input type="radio"[^>]*name="scope"[^>]*checked=""[^>]*value="complete"/); assert.match(start, /Complete Brand \(recommended\)/); assert.match(start, /Selected Families/); assert.match(start, /Partial \/ Other/);
  assert.doesNotMatch(start, /name="templates"/); assert.match(start, />Start review<\/button>/);
});

test("Complete step uses plain language, gates the button on server readiness, and keeps technical details", () => {
  const overview = (extra: Record<string, unknown> = {}) => ({ batch: { id: "r1", status: "review", scope: "complete" }, supplierOnly: { unmatched: 0, companions: 0 }, finished: { applied: 12, confirmed: 77, excluded: 4 },
    families: [{ template_id: "a", template_name: "A", items: 3, changed: 0, same: 0, missing: 0, attention: 0, done: 3, excluded: 0, status: "ready" }, { template_id: "b", template_name: "B", items: 2, changed: 0, same: 0, missing: 0, attention: 1, done: 1, excluded: 1, status: "needs_attention" }],
    totals: { families: 2, ready: 1, changed: 0, same: 0, missing: 0, attention: 1 }, ...extra });
  const summary = html(workflow.SupplierCompleteSummary, { overview: overview(), reviewHref: "/family" });
  for (const text of ["2 Families", "Prices updated", "12", "Unchanged prices confirmed", "77", "Items not listed by Supplier (excluded)", "1 item still needs a decision before you can complete.", "1 item needs attention", "Review items"]) assert.ok(summary.includes(text), text);
  assert.doesNotMatch(summary, /baseline_drift|target_not_represented|pricing_version|classification/);
  assert.match(html(workflow.SupplierCompleteSummary, { overview: overview({ totals: { families: 2, ready: 2, changed: 0, same: 0, missing: 0, attention: 0 } }), reviewHref: "/f" }), /Everything is resolved\./);
  const completion = html(controls.SupplierCompletionControls, { batchId: "r1", scope: "complete", status: "review", approver: true, reviewHref: "/family" });
  assert.match(completion, /Complete Review<\/h3>/); assert.match(completion, /<button[^>]*disabled=""[^>]*>Complete Brand Review<\/button>/); assert.match(completion, /Excluded targets will remain Needs price check/);
  assert.equal(html(controls.SupplierCompletionControls, { batchId: "r1", scope: "complete", status: "review", approver: false }), ""); // permissions unchanged
  assert.match(html(controls.SupplierCompletionControls, { batchId: "r1", scope: "partial", status: "review", approver: true }), /cannot activate a Brand-wide baseline because coverage is not Complete/);
  assert.doesNotMatch(html(controls.SupplierCompletionControls, { batchId: "r1", scope: "partial", status: "review", approver: true }), /<button/);
  assert.match(html(controls.SupplierCompletionControls, { batchId: "r1", scope: "complete", status: "completed", approver: true }), /review is completed/);
});

test("technical readiness details stay available inside the Complete control", async () => {
  const text = await read("./supplier-price-workspace-controls.tsx");
  assert.match(text, /View technical readiness details/); assert.match(text, /completionLabels\.map/); assert.match(text, /supplierCompletionStatus\(batchId\)/);
});

test("finish screen reports the activated baseline in friendly terms", () => {
  const overview = { batch: { id: "r1", status: "completed", scope: "complete" }, supplierOnly: { unmatched: 0, companions: 0 }, finished: { applied: 0, confirmed: 0, excluded: 0 }, totals: { families: 6, ready: 6, changed: 0, same: 0, missing: 0, attention: 0 },
    families: ["a", "b", "c", "d", "e", "f"].map((id, index) => ({ template_id: id, template_name: id, items: 1, changed: 0, same: 0, missing: 0, attention: 0, done: 1, excluded: index === 5 ? 1 : 0, status: "completed" })) };
  const finish = html(workflow.SupplierFinishScreen, { brandName: "LAS MOBILI", title: "February 2026", baselineDate: "2026-02-01", overview, priceUpdatesHref: "/products/price-updates", summaryHref: "/summary" });
  for (const text of ["Review completed. Brand price baseline activated.", "5 Product families checked", "1 Family still needs separate price verification", "Baseline date:", "2026-02-01", "Back to Price Updates", "View review summary"]) assert.ok(finish.includes(text), text);
  assert.doesNotMatch(finish, /batch/i);
});

test("page wiring: Family Review by default, Advanced Technical Review and technical deep links preserved, permissions untouched", () => {
  assert.match(pageSource, /\["advanced", "summary", "details", "complete", "start"\]\.includes\(requestedView\) \? requestedView : "family"/); // Family Review is the default
  assert.match(pageSource, /technicalDeepLink = !requestedView && \["status", "code", "template", "offset", "unitOffset"\]/); // old filter links open the technical workspace
  assert.match(pageSource, /view: "advanced"/); assert.match(pageSource, /Back to Family Review/); assert.match(pageSource, /href=\{clearFiltersHref\}>Clear filters/);
  assert.match(pageSource, /<SupplierReviewControls key=/); assert.match(pageSource, /<SupplierFamilyTable key=/); assert.match(pageSource, /<SupplierAdvancedImportSettings /);
  assert.match(pageSource, /<SupplierImportSummary/); assert.match(pageSource, /SupplierStartReview/);
  assert.match(pageSource, /canApproveBrandPrices\(profile\?\.role, profile\?\.account_status\)/);
  assert.doesNotMatch(pageSource, /lg:grid-cols-\[minmax\(260px,340px\)_1fr\]/); // no narrow permanent controls sidebar
  assert.doesNotMatch(pageSource, /Review batches|Selected batch|declaration only; no activation/);
});

test("Import card separates the file type from the saved import profile", () => {
  const one = html(controls.SupplierImportCard, { ...importProps, profiles: [profile("p1", "LAS MOBILI — Standard XLSX")] });
  assert.match(one, /<span[^>]*>Import profile<\/span><span[^>]*>LAS MOBILI — Standard XLSX <span[^>]*>· Ready<\/span>/); // single profile: shown, not a dropdown
  assert.doesNotMatch(one, /<select(?![^>]*aria-label="Supplier source")/); // the Supplier source choice is separate from the import profile; assert.doesNotMatch(one, /Import format|import format/);
  assert.match(one, /<span[^>]*>File type<\/span><span[^>]*>XLSX, CSV or JSON \(taken from the file\)<\/span>/); // read-only, derived from the chosen file
  assert.match(one, /accept="\.xlsx,\.csv,\.json"/); assert.doesNotMatch(one, /PDF|\.pdf/i); // only what the importer supports
  const many = html(controls.SupplierImportCard, { ...importProps, profiles: [profile("p1", "LAS MOBILI — Standard XLSX"), profile("p2", "LAS article + finish")] });
  assert.match(many, /<span[^>]*>Import profile<\/span><select[^>]*>[\s\S]*Choose import profile[\s\S]*LAS article \+ finish/);
  const none = html(controls.SupplierImportCard, { ...importProps, profiles: [] });
  assert.match(none, /This Brand needs an import profile before price lists can be imported\./); assert.match(none, /Set up import profile/);
  assert.doesNotMatch(one + many + none, /<textarea|full_code_column|<pre/);
});

test("normal Import card never asks to pick a profile when only one exists; currency and basis follow the profile", () => {
  const net = { ...profile("p1", "LAS MOBILI — Standard XLSX"), config: { ...profile("p1", "x").config, currency: "USD", basis: "net" } };
  const single = html(controls.SupplierImportCard, { ...importProps, profiles: [net] });
  assert.doesNotMatch(single, /<select(?![^>]*aria-label="Supplier source")|Choose import profile/); assert.match(single, /LAS MOBILI — Standard XLSX <span[^>]*>· Ready<\/span>/);
  assert.match(single, /<span[^>]*>Currency<\/span><span[^>]*>USD<\/span>/); assert.match(single, /<span[^>]*>Price basis<\/span><span[^>]*>Net<\/span>/); // read-only, from the auto-selected profile
  assert.match(single, /<span[^>]*>File type<\/span>/); assert.match(single, /type="file"/); assert.match(single, /name="title"/); assert.match(single, />Import price list<\/button>/);
  assert.doesNotMatch(single, /Change import profile/); // the change option lives only in Advanced import settings
  const advanced = html(controls.SupplierAdvancedImportSettings, { brandId: "b", brandName: "LAS MOBILI", basis: "list", approver: true, templates: [], profiles: [net] });
  assert.match(advanced, /Change import profile/); assert.match(advanced, /Profile JSON/); assert.match(single, /use <a[^>]*>Advanced import settings<\/a>/);
});
