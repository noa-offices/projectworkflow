import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { opportunityNumberFromQuotationNumber, quotationFolderNumberFromQuotationNumber } from "../projectworkflow-numbering";
import { readPricingRule } from "../quotation-pricing";
import { quotationOptionNoFromQuotationNo, quotationRevisionBaseNo, quotationRootBaseNo } from "../quotation-options";
import { isQuotationLocked } from "./quotation-lock";
import { latestPrimaryQuotationsByFolder, quotationSalesFolderKey } from "./sales-attribution";
import { quotationApprovalDisplay } from "./approval-display";
import {
  applyFirstMessage, folderProjectOrderNo, formatVariationNumber, isOpenVariation, noSnapshotMessage, oneOpenVariationMessage, projectFileCardState, revisionRefusal,
  variationCreationDecision, variationLabel, variationLayoutSettings, variationLine, variationLinkFromLayoutSettings, variationNoFromQuotationNo, variationRowsFromSnapshot, withoutVariationLink,
  type VariationLink,
} from "./project-variation";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const projectFile = (quotationId: string, orderNo = "CO-0002-001") => ({ orderNo, quotationId, quotationNo: "QN-0002-001-R5", clientId: "c", clientName: "Client", reference: "Office", total: 100, currency: "AED", createdAt: "2026-11-04", createdBy: "u" });
const link: VariationLink = { orderNo: "CO-0002-001", projectQuotationId: "q", snapshotId: "s", variationNo: 2, baseRevisionNo: 5 };

// ---- Numbers ----

test("variation numbers format and parse, including double digits", () => {
  assert.equal(formatVariationNumber("QN-0002-001", 1), "QN-0002-001-V1");
  assert.equal(formatVariationNumber("QN-0002-001", 12), "QN-0002-001-V12");
  assert.equal(variationNoFromQuotationNo("QN-0002-001-V1"), 1);
  assert.equal(variationNoFromQuotationNo("qn-0002-001-v2"), 2);
  assert.equal(variationNoFromQuotationNo("QN-0002-001-V12"), 12);
  for (const no of ["QN-0002-001", "QN-0002-001-R5", "QN-0002-001-OPT1", "QN-0002-001-V0", "OLD-V1", "", null, undefined]) assert.equal(variationNoFromQuotationNo(no), null, String(no));
});

test("the label and the header line", () => {
  assert.equal(variationLabel(link), "R5 · V2");
  assert.equal(variationLine(link), "Variation V2 to Project CO-0002-001 (based on R5)");
});

test("number parsers place a variation in its folder, and still read plain, R and option numbers", () => {
  for (const no of ["QN-0002-001", "QN-0002-001-R2", "QN-0002-001-OPT1", "QN-0002-001-OPT1-R3", "QN-0002-001-V1", "QN-0002-001-V12"]) {
    assert.equal(quotationFolderNumberFromQuotationNumber(no), "QF-0002-001", no);
    assert.equal(opportunityNumberFromQuotationNumber(no), "OP-0002-001", no);
    assert.equal(quotationRootBaseNo(no), "QN-0002-001", no);
    assert.equal(quotationSalesFolderKey({ id: "x", quotation_no: no }), "QN-0002-001", no);
  }
  assert.equal(quotationFolderNumberFromQuotationNumber("QN-0002-001-X1"), null);
  assert.equal(quotationRevisionBaseNo("QN-0002-001-R2"), "QN-0002-001");
  assert.equal(quotationOptionNoFromQuotationNo("QN-0002-001-OPT1"), 2);
  assert.equal(quotationOptionNoFromQuotationNo("QN-0002-001-V1"), 1);
  assert.equal(quotationRootBaseNo("123/0001-OPT-A-R01"), "123/0001"); // older numbers from the database trigger
});

test("a variation is never the folder's primary quotation in the sales report", () => {
  const row = (id: string, quotation_no: string, created_at: string) => ({ id, quotation_no, created_at, status: "client_confirmed", status_updated_at: null, revision_no: 0, option_no: 1, layout_settings: {} });
  const primary = latestPrimaryQuotationsByFolder([row("original", "QN-0002-001", "2026-01-01"), row("variation", "QN-0002-001-V1", "2026-11-01")] as never[]) as Array<{ id: string }>;
  assert.deepEqual(primary.map((entry) => entry.id), ["original"]);
});

test("a confirmed variation is never Project File Pending", () => {
  const input = { approved_salesperson_id: null, status: "client_confirmed", layout_settings: { variationOf: link } };
  assert.notEqual(quotationApprovalDisplay(input)?.state, "project_file_pending");
  assert.equal(quotationApprovalDisplay({ ...input, layout_settings: {} })?.state, "project_file_pending");
});

// ---- The Project File card ----

test("the card: every row of the table", () => {
  const state = (id: string, status: string, layoutSettings: unknown, folderOrderNo: string | null) => projectFileCardState({ id, status, layoutSettings, folderOrderNo });
  assert.deepEqual(state("q", "client_confirmed", {}, null), { kind: "before_project" });
  assert.deepEqual(state("q", "client_confirmed", { projectFile: projectFile("q") }, "CO-0002-001"), { kind: "open_project", orderNo: "CO-0002-001" });
  assert.deepEqual(state("v", "client_confirmed", { variationOf: { ...link, variationNo: 1 } }, "CO-0002-001"), { kind: "variation_confirmed", orderNo: "CO-0002-001", message: "Variation V1 is confirmed. Update the Project File to apply it." });
  const old = { kind: "folder_has_project", orderNo: "CO-0002-001", message: "This folder already has Project CO-0002-001. Use Create variation from the Project to change it." };
  assert.deepEqual(state("r2", "client_confirmed", {}, "CO-0002-001"), old);
  assert.deepEqual(state("r1", "draft", {}, "CO-0002-001"), old);
  assert.deepEqual(state("r2", "client_confirmed", { projectFile: projectFile("source") }, "CO-0002-001"), old); // a revision from before Step A that carries its source's record
  assert.equal(state("v", "draft", { variationOf: link }, "CO-0002-001").kind, "variation_open");
});

test("the folder's Project is found from any row of the folder, and not from another folder", () => {
  const rows = [
    { id: "a", quotation_no: "QN-0002-001", layout_settings: { projectFile: projectFile("a") } },
    { id: "b", quotation_no: "QN-0002-002", layout_settings: {} },
    { id: "c", quotation_no: "QN-0003-001", layout_settings: { clientApprovalDraft: {} } },
  ];
  for (const no of ["QN-0002-001", "QN-0002-001-R2", "QN-0002-001-OPT1", "QN-0002-001-V1"]) assert.equal(folderProjectOrderNo(rows, no), "CO-0002-001", no);
  assert.equal(folderProjectOrderNo(rows, "QN-0002-002"), null);
  assert.equal(folderProjectOrderNo(rows, null), null);
});

// ---- Rules ----

test("Create revision is refused for a locked quotation and for any quotation whose folder has a Project", () => {
  const message = "This folder already has Project CO-0002-001. Use Create variation from the Project to change it.";
  assert.equal(revisionRefusal({ layout_settings: { projectFile: projectFile("q") } }, null), message);
  assert.equal(revisionRefusal({ layout_settings: {} }, "CO-0002-001"), message);
  assert.equal(revisionRefusal({ layout_settings: {} }, null), null);
});

test("one open variation; a confirmed one must be applied first; a rejected one frees the next number", () => {
  const row = (quotation_no: string, status: string, is_active = true) => ({ quotation_no, status, is_active });
  assert.deepEqual(variationCreationDecision([]), { ok: true, variationNo: 1 });
  for (const status of ["draft", "internal_review", "revision_required", "ready_to_send", "sent_to_client", "on_hold"]) {
    assert.deepEqual(variationCreationDecision([row("QN-0002-001-V1", status)]), { ok: false, message: oneOpenVariationMessage(1) }, status);
  }
  assert.deepEqual(variationCreationDecision([row("QN-0002-001-V1", "client_confirmed")]), { ok: false, message: applyFirstMessage(1) });
  assert.deepEqual(variationCreationDecision([row("QN-0002-001-V1", "cancelled")]), { ok: true, variationNo: 2 });
  assert.deepEqual(variationCreationDecision([row("QN-0002-001-V1", "archived")]), { ok: true, variationNo: 2 });
  assert.deepEqual(variationCreationDecision([row("QN-0002-001-V1", "draft", false)]), { ok: true, variationNo: 2 });
  assert.deepEqual(variationCreationDecision([row("QN-0002-001-V9", "cancelled"), row("QN-0002-001-V10", "cancelled")]), { ok: true, variationNo: 11 });
  assert.equal(isOpenVariation(row("x", "draft")), true);
});

// ---- The copy ----

test("rows are built from the frozen copy, with new ids and parents, sections and layout references moved across", () => {
  let n = 0;
  const rows = variationRowsFromSnapshot({
    quotationId: "new-q", userId: "u", newId: () => `new-${++n}`,
    sections: [
      { original_section_id: "s1", data: { id: "s1", quotation_id: "old", section_title: "Main", parent_section_id: null, is_active: false, created_at: "then", updated_at: "then", created_by: "old-user" } },
      { original_section_id: "s2", data: { id: "s2", quotation_id: "old", section_title: "Sub", parent_section_id: "s1" } },
    ],
    items: [
      { original_item_id: "i1", data: { id: "i1", quotation_id: "old", section_id: "s2", parent_item_id: null, qty: 2, unit_price: 1554, net_price: 1399, net_total: 2798, internal_cost: 700, cell_layout: { a: 1 }, source_component_data: { x: 1 }, line_style: "normal", created_at: "then" } },
      { original_item_id: "i2", data: { id: "i2", quotation_id: "old", section_id: "inactive-section", parent_item_id: "i1", qty: 1 } },
    ],
  });
  assert.deepEqual(rows.sections[1], { section_title: "Sub", quotation_id: "new-q", is_active: true, created_by: "u", id: rows.idMap.get("s2"), parent_section_id: rows.idMap.get("s1") });
  const [first, second] = rows.items as Array<Record<string, unknown>>;
  assert.equal(first.id, rows.idMap.get("i1")); assert.equal(first.quotation_id, "new-q"); assert.equal(first.section_id, rows.idMap.get("s2"));
  assert.equal(first.net_total, 2798); assert.equal(first.internal_cost, 700); assert.deepEqual(first.cell_layout, { a: 1 }); assert.deepEqual(first.source_component_data, { x: 1 });
  assert.ok(!("created_at" in first));
  assert.equal(second.parent_item_id, rows.idMap.get("i1")); assert.equal(second.section_id, null);
  assert.equal(new Set(rows.idMap.values()).size, 4);
});

test("the settings keep the pricing rule and open unlocked, with row references moved", () => {
  const idMap = new Map([["i1", "new-i1"]]);
  const settings = variationLayoutSettings({
    projectFile: projectFile("q"), clientApprovalDraft: { confirmedOrder: {} }, projectCompletedAt: "x", procurementRfq: {}, quotationBranch: {}, pricing_rule: "whole_aed_v1",
    price_rounding: { rounded_net_prices: { i1: 1400 }, adjustment: 1 }, specificationImages: ["i1"],
  }, link, idMap) as Record<string, unknown>;
  assert.equal(readPricingRule(settings), "whole_aed_v1");
  assert.equal(isQuotationLocked({ layout_settings: settings }), false);
  for (const key of ["projectFile", "clientApprovalDraft", "projectCompletedAt", "procurementRfq", "quotationBranch"]) assert.ok(!(key in settings), key);
  assert.deepEqual(settings.price_rounding, { rounded_net_prices: { "new-i1": 1400 }, adjustment: 1 });
  assert.deepEqual(settings.specificationImages, ["new-i1"]);
  assert.deepEqual(variationLinkFromLayoutSettings(settings), link);
  assert.equal(readPricingRule(variationLayoutSettings({}, link, new Map())), "round_up_5_legacy");
});

test("a copy of a variation is an ordinary quotation", () => {
  assert.deepEqual(withoutVariationLink({ variationOf: link, pricing_rule: "whole_aed_v1" }), { pricing_rule: "whole_aed_v1" });
  const plain = { pricing_rule: "whole_aed_v1" };
  assert.equal(withoutVariationLink(plain), plain);
  for (const bad of [null, {}, { variationOf: {} }, { variationOf: { ...link, variationNo: 0 } }, { variationOf: { ...link, orderNo: " " } }]) assert.equal(variationLinkFromLayoutSettings(bad), null);
});

// ---- The action ----

const actions = read("app/quotations/actions.ts");
const body = actions.slice(actions.indexOf("export async function createProjectVariation"), actions.indexOf("export async function applyProjectVariation"));

test("the action reads the frozen copy, never live rows, and takes pricing, VAT and terms from it", () => {
  assert.match(body, /\.from\("project_snapshots"\)/);
  assert.match(body, /\.from\("project_snapshot_sections"\)/);
  assert.match(body, /\.from\("project_snapshot_items"\)/);
  assert.doesNotMatch(body, /\.from\("quotation_(items|sections)"\)\s*\.select/);
  assert.equal(noSnapshotMessage, "This Project has no frozen copy yet, so a variation cannot be created.");
  assert.match(body, /if \(!snapshot\) redirectWithMessage\(redirectPath, noSnapshotMessage\)/);
  for (const line of ["currency: scopeSource.currency", "vat_percent: scopeSource.vat_percent", "payment_terms: scopeSource.payment_terms", "validity: scopeSource.validity", "delivery_terms: scopeSource.delivery_terms", "warranty_terms: scopeSource.warranty_terms", "notes: scopeSource.notes", "overall_discount_value: scopeSource.overall_discount_value", "grand_total: scopeSource.grand_total", 'status: "draft"', "variationLayoutSettings(scopeSource.layout_settings, link, rows.idMap)"]) {
    assert.ok(body.includes(line), line);
  }
  assert.ok(!body.includes("recalculateQuotationTotals"), "it starts at the approved totals");
});

test("the action is role-checked like Create revision, stays clear of the numbering trigger, and leaves nothing half-made", () => {
  assert.match(body, /const \{ user, displayName \} = await requireQuotationActionUser\(\);/);
  assert.match(actions.slice(actions.indexOf("async function copyQuotation("), actions.indexOf("async function copyQuotation(") + 200), /await requireQuotationActionUser\(\)/);
  assert.ok(body.includes("project_id: null"));
  assert.ok(body.includes("validUuidOrNull(source.project_id)"));
  assert.ok(body.includes("created.quotation_no !== quotationNo"));
  assert.ok(body.includes('.from("quotations").delete().eq("id", newQuotationId)'));
  assert.ok(body.indexOf("variationCreationDecision(") < body.indexOf(".insert({"));
});

test("the database trigger only leaves the number alone when project_id is null", () => {
  const trigger = read("supabase/migrations/053_client_project_numbering.sql");
  assert.match(trigger, /if new\.project_id is null then\s+return new;/);
  assert.equal(read("supabase/migrations/062_opportunity_quotation_without_project.sql").includes("alter column project_id drop not null"), true);
});

test("revisions, options and client responses are guarded on the server", () => {
  const copy = actions.slice(actions.indexOf("async function copyQuotation("), actions.indexOf("export async function duplicateQuotation"));
  assert.ok(copy.indexOf('revisionRefusal(source, folderProjectOrderNo(') < copy.indexOf(".insert({"));
  assert.ok(copy.includes('mode === "option" && variationLinkFromLayoutSettings(source.layout_settings)'));
  assert.ok(copy.includes("layout_settings: withoutVariationLink(lockedSourceCopySettings(source, "));
  const draft = actions.slice(actions.indexOf("export async function createClientApprovalDraft"), actions.indexOf("export async function createClientApprovalDraft") + 4000);
  assert.ok(draft.includes("variationNoFromQuotationNo(quotation.quotation_no)"));
});

// ---- Screens ----

test("the buttons: variation on the Project page and locked view; no revision on the locked view", () => {
  const locked = read("components/quotations/quotation-locked-view.tsx");
  assert.ok(locked.includes("createProjectVariation") && locked.includes("Create variation"));
  assert.ok(!locked.includes("createQuotationRevision") && !locked.includes("Create revision"));
  assert.ok(locked.includes("createQuotationOption") && locked.includes("create_new_enquiry"));
  const project = read("app/projects/orders/[orderNo]/page.tsx");
  assert.equal(project.split("{variationForm}").length - 1, 2); // the buttons row and the Items tab
  assert.ok(project.indexOf("const variationForm") < project.indexOf("const lockedItemsSection"));
});

test("Create Project File is only reachable before a Project exists, on both screens", () => {
  const page = read("app/quotations/[id]/page.tsx");
  assert.match(page, /const canCreateProjectFile =\s+canManageRecords &&\s+projectCardState\.kind === "before_project"/);
  assert.ok(page.indexOf('projectCardState.kind !== "before_project" ? (') < page.indexOf("<CreateProjectFileForm\n"));
  assert.ok(page.includes("{variationLine(variationLink)}"));
  const approvals = read("app/sales/approvals/page.tsx");
  assert.ok(approvals.includes("projectFile: projectFile ?? (folderOrderNo ? { orderNo: folderOrderNo } : null)"));
  assert.ok(read("components/quotations/quotation-pdf-document.tsx").includes("{variationLine(link)}"));
  assert.ok(read("components/quotations/quotation-list-live-filter.tsx").includes("Variation {variationLabel(link)}"));
});
