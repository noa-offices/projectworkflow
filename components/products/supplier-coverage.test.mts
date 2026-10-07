import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
async function load<T>(path: string, dependencies: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(path, import.meta.url);
  const output = ts.transpileModule(await read(path), { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => Object.hasOwn(dependencies, name) ? dependencies[name] : createRequire(url)(name.startsWith("@/") ? fileURLToPath(new URL(`../../${name.slice(2)}`, import.meta.url)) : name), compiled, compiled.exports);
  return compiled.exports as T;
}
const link = { default: ({ children, ...props }: { href: string; children: unknown }) => React.createElement("a", props, children as never) };
type Component = (props: Record<string, unknown>) => React.ReactElement | null;
const coverage = await load<Record<"SupplierSourceField" | "SupplierCoverageSetup" | "SupplierCoverageContext" | "SupplierSourceSummary" | "SupplierSourcesOverview" | "SupplierFamilyCoverageSetup" | "suggestedSelection" | "filterCoverageRows" | "coverageClashes", Component>>("./supplier-coverage.tsx", {
  "next/link": link, "next/navigation": { useRouter() { return { refresh() {}, push() {} }; } }, "@/app/products/price-updates/supplier-sources/actions": {},
});
const helpers = coverage as unknown as { suggestedSelection(rows: unknown[]): Set<string>; filterCoverageRows(rows: unknown[], filters: { category: string; status: string; chip: string }): unknown[]; coverageClashes(rows: unknown[], selected: Set<string>, target: string): unknown[] };
const inspector = { SupplierSourceInspector: () => React.createElement("button", { type: "button" }, "View extracted data") };
const historyActions = await load("./supplier-history-actions.tsx", { "next/link": link, "next/navigation": { useRouter() { return { refresh() {} }; } }, "@/app/products/price-updates/supplier-sources/actions": {}, "./supplier-price-workspace-controls": { SupplierArchiveButton: () => React.createElement("button", null, "Archive") } });
const workflow = await load<Record<"SupplierFinishScreen" | "SupplierHistoryTable", Component>>("./supplier-price-workflow.tsx", { "next/link": link, "@/components/products/supplier-source-inspector": inspector, "@/components/products/supplier-history-actions": historyActions });
const html = (component: Component, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(component as never, props as never));
const pageSource = await read("../../app/products/price-updates/supplier-sources/page.tsx");
const controlsSource = await read("./supplier-price-workspace-controls.tsx");

const row = (templateName: string, found: number, total: number, extra: Record<string, unknown> = {}) => ({ templateId: templateName, templateName, totalTargetCodes: total, foundTargetCodes: found, foundRatio: total ? found / total : 0, previouslyCovered: false, isNewFamily: false, suggested: total > 0 && found / total >= 0.8, ...extra });
const rows = [row("MONOLITH", 60, 60), row("OXI_P", 10, 10), row("Sigma", 81, 81), row("Universal Cabinet", 225, 225), row("Universal Screen", 146, 146), row("LEAD", 0, 72)];
const source = { id: "s1", title: "LAS MOBILI — October 2026" };
const setup = (props: Record<string, unknown> = {}) => ({ brandId: "b", source, definition: { id: "d1", name: "LAS Furniture", profileTitle: "LAS MOBILI — Standard XLSX", coveredIds: [] as string[] }, rows, definitions: [], others: {}, approver: true, editing: false, editHref: "/x?edit=1", doneHref: "/x", laterHref: "/x", conflicts: [], ...props });

test("Supplier source selector lists existing sources and offers a new source; the import profile is a separate field", () => {
  const existing = html(coverage.SupplierSourceField, { options: [{ id: "d1", name: "LAS Furniture", familyCount: 5 }, { id: "d2", name: "LAS Chairs", familyCount: 1 }], choice: { value: "d1", newName: "" }, onChangeAction() {}, profileTitle: "LAS MOBILI — Standard XLSX" });
  assert.match(existing, /Supplier source/); assert.match(existing, /LAS Furniture/); assert.match(existing, /LAS Chairs/); assert.match(existing, /New source/);
  assert.match(existing, /A source groups recurring price lists with the same Family coverage\./); assert.doesNotMatch(existing, /Source name/);
  const created = html(coverage.SupplierSourceField, { options: [], choice: { value: "new", newName: "LAS Furniture" }, onChangeAction() {}, profileTitle: "LAS MOBILI — Standard XLSX" });
  assert.match(created, /Source name/); assert.match(created, /Import profile/); assert.match(created, /LAS MOBILI — Standard XLSX/);
  assert.match(created, /Use one source for each recurring price-list type, such as Furniture, Chairs or Accessories\./);
  assert.doesNotMatch(created, /uuid|JSON|template_id/i);
  assert.match(controlsSource, /SupplierSourceField/); assert.match(controlsSource, /linkSupplierSourceDefinition/); assert.match(controlsSource, /createSupplierSourceDefinition/); // wired into the Import card
});

test("suggested coverage table: found/total, percent, status labels, undecided and unchecked rows stay visible", () => {
  const out = html(coverage.SupplierCoverageSetup, setup({ rows: [...rows, row("LATE", 3, 4, { isNewFamily: true, suggested: false }), row("OLD", 0, 5, { previouslyCovered: true, suggested: true })] }));
  assert.match(out, /Suggested Family coverage/); assert.match(out, /ProjectWorkflow compared the extracted Supplier codes with your Product Families\./);
  assert.match(out, /60 \/ 60/); assert.match(out, /0 \/ 72/); assert.match(out, />100%</); assert.match(out, />0%</);
  assert.match(out, /Strong match/); assert.match(out, /No matching codes/); assert.match(out, /New Family/); assert.match(out, /Previously covered/);
  const box = (name: string) => out.match(new RegExp(`<input[^>]*aria-label="Include ${name}"[^>]*>`))![0];
  for (const name of ["MONOLITH", "OXI_P", "Sigma", "Universal Cabinet", "Universal Screen", "OLD"]) assert.match(box(name), /checked/);
  for (const name of ["LEAD", "LATE"]) assert.doesNotMatch(box(name), /checked/); // zero overlap and a new Family are visible but not included
  assert.match(out, /Confirm Family coverage/); assert.match(out, /Review later/);
});

test("confirmed coverage: shows covered / not covered counts and an Edit coverage action; a conflict blocks with a friendly message", () => {
  const confirmed = html(coverage.SupplierCoverageSetup, setup({ definition: { id: "d1", name: "LAS Furniture", profileTitle: null, coveredIds: rows.slice(0, 5).map((item) => item.templateId) } }));
  assert.match(confirmed, /Coverage confirmed/); assert.match(confirmed, /LAS Furniture covers 5 Families; 1 Family is not covered\./); assert.match(confirmed, /Edit coverage/);
  const editing = html(coverage.SupplierCoverageSetup, setup({ editing: true, definition: { id: "d1", name: "LAS Furniture", profileTitle: null, coveredIds: ["MONOLITH"] } }));
  assert.match(editing, /Edit Family coverage/); assert.match(editing, /Confirm Family coverage/);
  const conflicted = html(coverage.SupplierCoverageSetup, setup({ definition: { id: "d1", name: "LAS Furniture", profileTitle: null, coveredIds: ["LEAD"] }, conflicts: [{ templateId: "LEAD", templateName: "LEAD", definitions: [{ definitionId: "d1", definitionName: "LAS Furniture" }, { definitionId: "d2", definitionName: "LAS Chairs" }] }] }));
  assert.match(conflicted, /Resolve Family coverage conflicts before starting this review\./); assert.match(conflicted, /LEAD: LAS Furniture, LAS Chairs/); assert.doesNotMatch(conflicted, /violates|constraint|error:/i);
  const clash = html(coverage.SupplierCoverageSetup, setup({ others: { LEAD: ["LAS Chairs"] }, rows: [row("LEAD", 5, 5, { previouslyCovered: true, suggested: true })] }));
  assert.match(clash, /Also covered by LAS Chairs\. Saving creates a coverage conflict to resolve before review\./); // shown before saving
});

test("a source without a definition asks for a Supplier source instead of silently covering the whole Brand", () => {
  const out = html(coverage.SupplierCoverageSetup, setup({ definition: null, rows: [], definitions: [{ id: "d1", name: "LAS Furniture", familyCount: 5 }] }));
  assert.match(out, /not linked to a Supplier source yet/); assert.match(out, /Use this Supplier source/); assert.match(out, /LAS Furniture/);
});

test("read-only users see coverage but get no mutation controls", () => {
  const out = html(coverage.SupplierCoverageSetup, setup({ approver: false }));
  assert.doesNotMatch(out, /Confirm Family coverage/); assert.match(out, /An approver confirms Family coverage\./); assert.match(out, /<input[^>]*disabled[^>]*>/);
  const confirmed = html(coverage.SupplierCoverageSetup, setup({ approver: false, definition: { id: "d1", name: "LAS Furniture", profileTitle: null, coveredIds: ["MONOLITH"] } }));
  assert.doesNotMatch(confirmed, /Edit coverage/);
  assert.doesNotMatch(html(coverage.SupplierSourceSummary, { sourceName: "LAS Furniture", coveredCount: 5, profileTitle: "P", priceList: "Oct", approver: false, editHref: "/e", detailsHref: "/d", advancedHref: "/a" }), /Edit coverage|Advanced tools/);
});

test("source summary names the source, coverage, import profile and price list separately", () => {
  const out = html(coverage.SupplierSourceSummary, { sourceName: "LAS Furniture", coveredCount: 5, profileTitle: "LAS MOBILI — Standard XLSX", priceList: "LAS MOBILI — October 2026", approver: true, editHref: "/e", detailsHref: "/d", advancedHref: "/a" });
  for (const text of ["Supplier source", "LAS Furniture", "Coverage", "5 Families", "Import profile", "LAS MOBILI — Standard XLSX", "Price list", "LAS MOBILI — October 2026", "Edit coverage", "View extracted data", "Advanced tools"]) assert.match(out, new RegExp(text));
});

test("Family Review context line shows the covered Family count and the source; uncovered Families are not Missing", () => {
  const out = html(coverage.SupplierCoverageContext, { sourceName: "LAS Furniture", covered: ["MONOLITH", "OXI_P", "Sigma", "Universal Cabinet", "Universal Screen"], notCovered: 1 });
  assert.match(out, /Reviewing 5 covered Families from LAS Furniture/); assert.match(out, /1 other Family is not part of this price list and are not reviewed here|not reviewed here/); assert.doesNotMatch(out, /Missing/);
  assert.match(pageSource, /coverageContext/); assert.match(pageSource, /\{coverageContext\}/);
});

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const family = (name: string, found: number | null, total: number | null, extra: Record<string, unknown> = {}) => ({ templateId: U(name.split("").reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 1_000_000, 7)), templateName: name, mainCategory: null, subCategory: null, totalTargetCodes: total, foundTargetCodes: found, foundRatio: total ? (found as number) / total : null, suggested: Boolean(total && (found as number) / total >= 0.8), currentSources: [] as Array<{ definitionId: string; definitionName: string }>, ...extra });
const familyRows = [
  family("MONOLITH", 60, 60, { mainCategory: "Desk", subCategory: "Executive Desk" }), family("OXI_P", 10, 10, { mainCategory: "Desk", subCategory: "Workstation" }), family("Sigma", 81, 81, { mainCategory: "Desk", subCategory: "Workstation" }),
  family("Universal Cabinet", 225, 225, { mainCategory: "Storage", subCategory: "Cabinet" }), family("UNIVERSAL SCREEN", 146, 146, { mainCategory: "Screen" }), family("LEAD", 0, 72, { mainCategory: "Chair", subCategory: "Executive Chair" }),
];
const tableProps = (extra: Record<string, unknown> = {}) => ({ brandId: "b", rows: familyRows, sources: [{ id: "d1", name: "LAS Furniture", familyCount: 0 }], profiles: [{ id: "p1", title: "LAS MOBILI — Standard XLSX" }], approver: true, referenceTitle: "LAS MOBILI — October 2026", ...extra });
const visibleText = (markup: string) => markup.replace(/<[^>]+>/g, " ");
const names = (list: unknown) => (list as Array<{ templateName: string }>).map((row) => row.templateName);

test("Family Coverage Setup table: heading, Family, library category, codes found, coverage and status", () => {
  const out = html(coverage.SupplierFamilyCoverageSetup, tableProps());
  assert.match(out, /Family Coverage Setup/); assert.match(out, /Choose which Supplier source is responsible for each Product Family\./);
  for (const heading of ["Family", "Library category", "Codes found", "Coverage", "Status", "Current source"]) assert.match(out, new RegExp(`>${heading}<`));
  for (const text of ["MONOLITH", "Desk / Executive Desk", "Desk / Workstation", "Storage / Cabinet", ">Screen<", "Chair / Executive Chair", "60 / 60", "225 / 225", "0 / 72", ">100%<", ">0%<", "Strong match", "No matching codes"]) assert.ok(out.includes(text), text);
  assert.match(out, /Unassigned/); assert.doesNotMatch(out, /Missing/);
  assert.match(out, /6 Families · 0 covered · 6 uncovered · 5 suggested · 0 conflicts/); // compact totals, no dashboard cards
  assert.match(out, /overflow-x-auto/); // narrow screens scroll inside the card
});

test("no raw IDs or JSON are shown; a category-less Family shows only what the Library has", () => {
  const out = visibleText(html(coverage.SupplierFamilyCoverageSetup, tableProps()));
  assert.doesNotMatch(out, /[0-9a-f]{8}-[0-9a-f]{4}-/); assert.doesNotMatch(out, /[{}]|template_id|definition_id/);
  assert.match(html(coverage.SupplierFamilyCoverageSetup, tableProps({ rows: [family("Orphan", 1, 2)] })), /No category/);
});

test("Select suggested picks strong matches and previously assigned Families, never zero-overlap Families", () => {
  const picked = helpers.suggestedSelection(familyRows as never) as unknown as Set<string>;
  assert.equal(picked.size, 5); assert.equal(picked.has(familyRows[5].templateId), false); // LEAD 0 / 72 stays unchecked
  const assigned = [...familyRows.slice(0, 5), family("LEAD", 0, 72, { suggested: true, currentSources: [{ definitionId: "d2", definitionName: "LAS Chairs" }] })];
  assert.equal((helpers.suggestedSelection(assigned as never) as unknown as Set<string>).size, 6); // previously confirmed coverage is kept
  const out = html(coverage.SupplierFamilyCoverageSetup, tableProps());
  for (const label of ["Select suggested", "Select all", "Clear selection"]) assert.match(out, new RegExp(label));
  assert.doesNotMatch(out.match(/<input[^>]*aria-label="Select LEAD"[^>]*>/)![0], /checked/);
});

test("category, status and quick-chip filters narrow the table", () => {
  const rows = familyRows as never;
  assert.deepEqual(names(helpers.filterCoverageRows(rows, { category: "Desk / Workstation", status: "", chip: "all" } as never)), ["OXI_P", "Sigma"]);
  assert.deepEqual(names(helpers.filterCoverageRows(rows, { category: "", status: "none", chip: "all" } as never)), ["LEAD"]);
  assert.equal((helpers.filterCoverageRows(rows, { category: "", status: "", chip: "suggested" } as never) as unknown as unknown[]).length, 5);
  assert.deepEqual(names(helpers.filterCoverageRows(rows, { category: "", status: "", chip: "none" } as never)), ["LEAD"]);
  assert.equal((helpers.filterCoverageRows(rows, { category: "", status: "", chip: "unassigned" } as never) as unknown as unknown[]).length, 6);
  const out = html(coverage.SupplierFamilyCoverageSetup, tableProps());
  assert.match(out, /All categories/); assert.match(out, /All statuses/); for (const chip of ["All", "Suggested", "No match", "Unassigned"]) assert.match(out, new RegExp(`>${chip}<`));
});

test("current source column, coverage conflicts and the bulk-assignment warning", () => {
  const covered = familyRows.map((row, index) => index < 5 ? { ...row, currentSources: [{ definitionId: "d1", definitionName: "LAS Furniture" }] } : row);
  const out = html(coverage.SupplierFamilyCoverageSetup, tableProps({ rows: covered }));
  assert.match(out, /LAS Furniture/); assert.match(out, /Unassigned/); assert.match(out, /5 covered · 1 uncovered/);
  const conflicted = [...covered.slice(0, 5), { ...familyRows[5], currentSources: [{ definitionId: "d1", definitionName: "LAS Furniture" }, { definitionId: "d2", definitionName: "LAS Chairs" }] }];
  const clash = html(coverage.SupplierFamilyCoverageSetup, tableProps({ rows: conflicted }));
  assert.match(clash, />Conflict</); assert.match(clash, /Coverage conflict/); assert.match(clash, /Resolve conflict/); assert.match(clash, /1 conflict/); assert.match(clash, /border-red-200/);
  assert.doesNotMatch(out, /border-red-200/); // red is only for a real conflict, never for normal uncovered Families
  const lead = { ...familyRows[5], currentSources: [{ definitionId: "d2", definitionName: "LAS Chairs" }] };
  assert.deepEqual(names(helpers.coverageClashes([lead, familyRows[0]] as never, new Set([lead.templateId, familyRows[0].templateId]) as never, "d1" as never)), ["LEAD"]); // already covered elsewhere; an unassigned Family does not clash
  assert.deepEqual(helpers.coverageClashes([{ ...lead, currentSources: [{ definitionId: "d1", definitionName: "LAS Furniture" }] }] as never, new Set([lead.templateId]) as never, "d1" as never), []); // already in the target source
});

test("read-only users see category, codes, status and source but get no checkboxes, bulk actions, Create source or Resolve conflict", () => {
  const conflicted = [...familyRows.slice(0, 5), { ...familyRows[5], currentSources: [{ definitionId: "d1", definitionName: "A" }, { definitionId: "d2", definitionName: "B" }] }];
  const out = html(coverage.SupplierFamilyCoverageSetup, tableProps({ approver: false, rows: conflicted }));
  assert.match(out, /Chair \/ Executive Chair/); assert.match(out, /0 \/ 72/); assert.match(out, /Coverage conflict/);
  assert.doesNotMatch(out, /type="checkbox"/); assert.doesNotMatch(out, /Select suggested|Select all|Clear selection|Assign selected|Create new source|Create and assign|Resolve conflict/);
});

test("Brand overview lists several current sources without per-Family cards", () => {
  const out = html(coverage.SupplierSourcesOverview, { brandId: "b", approver: true, editCoverageHrefs: { d1: "/coverage/d1", d2: "/coverage/d2" }, definitions: [{ id: "d1", name: "LAS Furniture", profileId: null, profileTitle: null, isActive: true, canDelete: false, families: [{ id: "a", name: "MONOLITH" }, { id: "b", name: "OXI_P" }], latest: { id: "s1", title: "October 2026", receivedAt: null } }, { id: "d2", name: "LAS Chairs", profileId: null, profileTitle: null, isActive: true, canDelete: true, families: [{ id: "c", name: "LEAD" }], latest: null }] });
  assert.match(out, /Current Supplier sources/); assert.match(out, /LAS Furniture/); assert.match(out, /2 Families/); assert.match(out, /Latest: October 2026/); assert.match(out, /LAS Chairs/); assert.match(out, /Waiting for a price list/);
  assert.match(out, /Rename|Edit coverage|Archive|Delete/); assert.match(out, /href="\/coverage\/d1"/); assert.match(out, /Cannot delete a source with imported price lists or review history/); assert.doesNotMatch(out, /Assign source|Uncovered Families/);
});

test("History shows the source name; Start review is blocked while coverage is unconfirmed or in conflict", () => {
  const history = html(workflow.SupplierHistoryTable, { rows: [{ id: "1", title: "October 2026", sourceName: "LAS Furniture", date: "2026-10-05", status: "current", coverage: "Complete Brand", baseline: "—", viewHref: "/v" }], showArchived: false, archivedCount: 0, toggleHref: "/t", pagerHrefs: { previous: "/p", next: "/n" }, canArchive: false, reviews: [] });
  assert.match(history, /LAS Furniture/); assert.match(history, /October 2026/);
  assert.match(pageSource, /startBlocked/); assert.match(pageSource, /Confirm Family coverage before starting this review\./); assert.match(pageSource, /Resolve Family coverage conflicts before starting this review\./);
});

test("completion wording: partial coverage never claims a Brand baseline; full coverage wording is unchanged", () => {
  const props = { brandName: "LAS MOBILI", title: "October 2026", baselineDate: "2026-10-05", overview: null, priceUpdatesHref: "/p", summaryHref: "/s" };
  const partial = html(workflow.SupplierFinishScreen, { ...props, partialSource: "LAS Furniture" });
  assert.match(partial, /LAS Furniture review completed\./); assert.match(partial, /Other Families remain covered by other Supplier sources or need separate coverage\./); assert.doesNotMatch(partial, /Brand price baseline activated/);
  assert.match(html(workflow.SupplierFinishScreen, props), /Review completed\. Brand price baseline activated\./);
  assert.match(controlsSource, /review completed\. \$\{result\.checked_templates\} covered/); assert.match(controlsSource, /Complete Brand Review/); assert.match(controlsSource, /baseline \$\{result\.baseline_date/); // partial and full branches
});

// ---- Phase H: Available price lists landing section ----
const pageText = await read("../../app/products/price-updates/supplier-sources/page.tsx");
const cardsCoverage = await load<Record<"SupplierPriceListCards", Component>>("./supplier-coverage.tsx", { "@/components/products/supplier-history-actions": historyActions, "next/link": link, "next/navigation": { useRouter() { return { refresh() {}, push() {} }; } }, "@/app/products/price-updates/supplier-sources/actions": {} });
const view = (extra: Record<string, unknown>) => ({ sourceId: "s", sourceName: "LAS Furniture", title: "LAS MOBILI — October 2026", currency: "EUR", profileId: null, families: 5, sourceRows: 46108, items: 3479, compacted: true, batchId: null, batchStatus: null, scope: null, state: "ready_to_review", unresolved: 0, unchanged: 0, changed: 0, openHref: "/open-furniture", editHref: "/edit-furniture", detailsHref: "/details-furniture", advancedHref: "/advanced", ...extra });
const twoLists = [view({ sourceId: "f", state: "needs_attention", batchId: "bf", batchStatus: "review", unresolved: 8, unchanged: 56, openHref: "/open-furniture" }), view({ sourceId: "c", sourceName: "LAS Chairs", families: 1, sourceRows: 203870, items: 10206, compacted: false, state: "ready_to_complete", batchId: "bc", batchStatus: "review", openHref: "/open-chairs", editHref: "/edit-chairs", detailsHref: "/details-chairs" })];

test("Available price lists is the primary section; two sources with the same price-list title are two distinct entries", () => {
  const out = html(cardsCoverage.SupplierPriceListCards, { cards: twoLists, importHref: "/import", approver: true });
  assert.match(out, /Available price lists/); assert.equal((out.match(/More actions for/g) ?? []).length, 2);
  assert.match(out, /LAS Furniture/); assert.match(out, /LAS Chairs/);
  assert.equal((out.match(/>LAS MOBILI — October 2026</g) ?? []).length, 2); // same title, still distinguishable by the source line above it
  assert.doesNotMatch(out, /Review in progress/);
});

test("each card resolves its own review: Chairs opens Chairs, Furniture opens Furniture, and no Brand-wide Continue Review is shown", () => {
  const out = html(cardsCoverage.SupplierPriceListCards, { cards: twoLists, importHref: "/import", approver: true });
  const card = (name: string) => out.split("<li class=").find((part) => part.includes(name)) ?? "";
  assert.match(card("LAS Furniture"), /href="\/open-furniture"/); assert.match(card("LAS Furniture"), />Continue review</);
  assert.match(card("LAS Chairs"), /href="\/open-chairs"/); assert.match(card("LAS Chairs"), />Complete review</);
  assert.doesNotMatch(card("LAS Chairs"), /open-furniture/); assert.doesNotMatch(card("LAS Furniture"), /open-chairs/);
});

test("states: no batch shows Start review, attention and completed render, and the secondary actions live in a menu", () => {
  const cards = [view({ sourceId: "n", state: "ready_to_review" }), view({ sourceId: "a", sourceName: "X", state: "needs_attention", batchId: "b1", batchStatus: "review", unresolved: 3 }), view({ sourceId: "d", sourceName: "Y", state: "completed", batchId: "b2", batchStatus: "completed", openHref: "/done" }), view({ sourceId: "k", sourceName: "Z", state: "no_coverage", openHref: "/cover" })];
  const out = html(cardsCoverage.SupplierPriceListCards, { cards, importHref: "/import", approver: true });
  assert.match(out, />Start review</); assert.match(out, />Needs attention</); assert.match(out, />View completed review</); assert.match(out, />Confirm coverage</);
  assert.match(out, /3 items need attention/); assert.match(out, /aria-label="More actions for LAS MOBILI — October 2026"/);
  assert.match(out, />View extracted data</); assert.match(out, />Edit coverage</); assert.match(out, />Advanced tools</);
  assert.equal((out.match(/Edit coverage/g) ?? []).length, 4); // one per card, inside its menu only
});

test("Leave review sits beside Continue review only for approvers on an open (matching/review) batch", async () => {
  const cards = [
    view({ sourceId: "o", sourceName: "Open", state: "needs_attention", batchId: "open-b", batchStatus: "review" }),
    view({ sourceId: "m", sourceName: "Matching", state: "in_review", batchId: "match-b", batchStatus: "matching" }),
    view({ sourceId: "d", sourceName: "Done", state: "completed", batchId: "done-b", batchStatus: "completed" }),
    view({ sourceId: "x", sourceName: "Abandoned", state: "ready_to_review", batchId: "ab-b", batchStatus: "abandoned" }),
    view({ sourceId: "n", sourceName: "NoBatch", state: "ready_to_review" }),
  ];
  const out = html(cardsCoverage.SupplierPriceListCards, { cards, importHref: "/import", approver: true });
  const card = (name: string) => out.split("<li class=").find((part) => part.includes(name)) ?? "";
  for (const name of ["Open", "Matching"]) { assert.match(card(name), />Leave review<\/button>/); assert.match(card(name), /Leave this Supplier review\?/); }
  assert.match(card("Open"), />Continue review</);
  for (const name of ["Done", "Abandoned", "NoBatch"]) assert.doesNotMatch(card(name), /Leave review/);
  const readOnly = html(cardsCoverage.SupplierPriceListCards, { cards, importHref: "/import", approver: false });
  assert.doesNotMatch(readOnly, /Leave review/); assert.match(readOnly, />Continue review</);
  assert.ok((await read("./supplier-coverage.tsx")).includes('import { SupplierLeaveReviewButton } from "@/components/products/supplier-history-actions"'));
});

test("read-only users see the cards but no import, coverage edit or advanced actions; no raw IDs appear", () => {
  const out = html(cardsCoverage.SupplierPriceListCards, { cards: twoLists, importHref: "/import", approver: false });
  assert.match(out, /LAS Chairs/); assert.match(out, />Continue review</); assert.doesNotMatch(out, /Import new price list|Edit coverage|Advanced tools/);
  assert.doesNotMatch(out, /[0-9a-f]{8}-[0-9a-f]{4}-/);
  assert.match(html(cardsCoverage.SupplierPriceListCards, { cards: [], importHref: "/import", approver: true }), /No Supplier price lists yet\./);
});

test("page: price lists come first, coverage is a collapsed summary, system health is collapsed, and the global banner is gone", () => {
  assert.doesNotMatch(pageText, /inProgress/); assert.doesNotMatch(pageText, /Review in progress/);
  assert.match(pageText, /<SupplierPriceListCards cards=\{priceListCards\}/);
  assert.ok(pageText.indexOf("<SupplierPriceListCards") < pageText.indexOf("Family coverage <span"));
  assert.match(pageText, /open=\{coverage\.uncovered\.length > 0 \|\| coverage\.conflicts\.length > 0\}/); // open only when something needs attention
  assert.match(pageText, /System \/ database health/); assert.match(pageText, /<SupplierCapacityPanel \/>/);
  assert.ok(pageText.indexOf("<SupplierAdvancedImportSettings") < pageText.indexOf("System / database health"));
});

test("a single price list shows one card with its family count and the Start review action", () => {
  const out = html(cardsCoverage.SupplierPriceListCards, { cards: [view({ sourceId: "f" })], importHref: "/import", approver: true });
  assert.equal((out.match(/More actions for/g) ?? []).length, 1); assert.match(out, />Ready to review</); assert.match(out, />Start review</);
  assert.match(out, /Families<\/dt><dd class="font-semibold tabular-nums text-zinc-950">5</);
});

test("multiple versions remain visible with separate price-list and review badges", () => {
  const cards = [view({ sourceId: "new", title: "New list", priceListState: "update_in_progress", effectiveFrom: "2026-10-01", batchStatus: "review", unresolved: 1 }), view({ sourceId: "old", title: "Old list", priceListState: "current", batchStatus: "completed" }), view({ sourceId: "future", title: "Future list", priceListState: "upcoming" })];
  const out = html(cardsCoverage.SupplierPriceListCards, { cards, importHref: "/import", approver: true });
  for (const text of ["New list", "Old list", "Future list", "Updates in progress", "Price list: Current", "Price list: Update in progress", "Price list: Upcoming", "Review: Completed", "Review: In progress", "Effective date: 2026-10-01"]) assert.ok(out.includes(text), text);
  assert.equal((out.match(/Price list: Current/g) ?? []).length, 1);
});

test("a replaced completed source leaves the Current cards and remains available through History", () => {
  const out = html(cardsCoverage.SupplierPriceListCards, { cards: [view({ sourceId: "new", title: "New baseline", priceListState: "current", batchStatus: "completed" }), view({ sourceId: "old", title: "Old baseline", priceListState: "previous", batchStatus: "completed" })], importHref: "/import", approver: true });
  assert.match(out, /New baseline/); assert.doesNotMatch(out, /Old baseline/);
});
