import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildTeamContribution,
  LOGGED_EDIT_ACTIONS,
  mostQuotesCreatedIds,
  type ContributionQuotation,
  type EditAuditRow,
} from "./team-contribution.js";
import { formatSalesReportAED } from "../insights/sales-report-money.js";

const range = { from: "2026-01-01T00:00:00.000Z", to: "2026-06-30T23:59:59.999Z" };
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const page = read("app/insights/sales-report/page.tsx");

function quote(id: string, quotationNo: string, createdBy: string | null, createdAt: string, total: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    quotation_no: quotationNo,
    option_no: null,
    revision_no: null,
    created_by: createdBy,
    created_at: createdAt,
    grand_total: total,
    currency: "AED",
    title: id,
    status: "draft",
    status_updated_at: null,
    layout_settings: null,
    ...extra,
  } as ContributionQuotation;
}

function edit(by: string, quotationId: string, createdAt = "2026-03-10T09:00:00.000Z", action = "quotation_item_updated", entityType = "quotation_item"): EditAuditRow {
  return {
    action,
    created_at: createdAt,
    created_by: by,
    entity_id: entityType === "quotation" ? quotationId : "item-1",
    entity_type: entityType,
    parent_entity_id: entityType === "quotation" ? null : quotationId,
  };
}

const users = ["designer", "manager", "A", "B"];
const build = (quotations: ContributionQuotation[], editAudit: EditAuditRow[] = [], creationAudit = []) =>
  buildTeamContribution({ creationAudit, editAudit, quotations, range, userIds: users });

test("created by the Designer, owned by the Sales Manager: value goes to the Designer, owner gets nothing", () => {
  const result = build([quote("q1", "QN-0001-001", "designer", "2026-02-01T09:00:00.000Z", 97350, { salesperson_id: "manager", approved_salesperson_id: "manager" })]);
  assert.equal(result.designer.createdCount, 1);
  assert.equal(result.designer.createdValue, 97350);
  assert.equal(result.manager.createdCount, 0);
  assert.equal(result.manager.createdValue, 0);
  assert.equal(result.manager.editedCount, 0);
});

test("created by A, edited by B: A gets created, B gets Edited 1 and value 0", () => {
  const result = build([quote("q1", "QN-0001-001", "A", "2026-02-01T09:00:00.000Z", 5000)], [edit("B", "q1")]);
  assert.equal(result.A.createdCount, 1);
  assert.equal(result.A.createdValue, 5000);
  assert.equal(result.A.editedCount, 0);
  assert.equal(result.B.editedCount, 1);
  assert.equal(result.B.createdCount, 0);
  assert.equal(result.B.createdValue, 0);
});

test("created and edited by the same person counts once as created, not as an edit", () => {
  const result = build([quote("q1", "QN-0001-001", "A", "2026-02-01T09:00:00.000Z", 5000)], [edit("A", "q1"), edit("A", "q1", "2026-03-11T09:00:00.000Z", "quotation_updated", "quotation")]);
  assert.equal(result.A.createdCount, 1);
  assert.equal(result.A.editedCount, 0);
});

test("revisions of one folder are counted once, at the latest value, for the creator of the earliest quote", () => {
  const result = build([
    quote("q1", "QN-0001-001", "A", "2026-02-01T09:00:00.000Z", 1000),
    quote("q2", "QN-0001-001-R1", "B", "2026-02-10T09:00:00.000Z", 1200, { revision_no: 1 }),
  ]);
  assert.equal(result.A.createdCount, 1);
  assert.equal(result.A.createdValue, 1200);
  assert.equal(result.B.createdCount, 0);
  assert.equal(result.B.createdValue, 0);
  assert.equal(result.A.monthlyData.reduce((sum, month) => sum + month.total, 0), 1);
});

test("a creator missing on the quotation falls back to the quotation_created audit row", () => {
  const result = build(
    [quote("q1", "QN-0001-001", null, "2026-02-01T09:00:00.000Z", 700)],
    [],
    [{ entity_id: "q1", created_by: "A", created_at: "2026-02-01T09:00:00.000Z" }] as never,
  );
  assert.equal(result.A.createdCount, 1);
  assert.equal(result.A.createdValue, 700);
  assert.equal(build([quote("q1", "QN-0001-001", null, "2026-02-01T09:00:00.000Z", 700)]).A.createdCount, 0);
});

test("date range: created outside the range and edits outside the range are not counted", () => {
  const result = build(
    [quote("old", "QN-0002-001", "A", "2025-11-01T09:00:00.000Z", 900), quote("q1", "QN-0001-001", "A", "2026-02-01T09:00:00.000Z", 100)],
    [edit("B", "q1", "2025-12-31T23:59:59.000Z"), edit("B", "old", "2026-07-01T00:00:01.000Z")],
  );
  assert.equal(result.A.createdCount, 1);
  assert.equal(result.A.createdValue, 100);
  assert.equal(result.B.editedCount, 0);
});

test("only the listed log actions count as an edit; a quote edited many times counts once", () => {
  const q = [quote("q1", "QN-0001-001", "A", "2026-02-01T09:00:00.000Z", 100)];
  const notEdits = ["quotation_status_updated", "quotation_salesperson_reassigned", "quotation_archived", "client_approval_prepared", "project_file_created", "quotation_created"].map((action) =>
    edit("B", "q1", "2026-03-10T09:00:00.000Z", action, "quotation"));
  assert.equal(build(q, notEdits).B.editedCount, 0);
  const many = [edit("B", "q1"), edit("B", "q1", "2026-03-11T09:00:00.000Z", "quotation_item_added"), edit("B", "q1", "2026-03-12T09:00:00.000Z", "quotation_updated", "quotation")];
  assert.equal(build(q, many).B.editedCount, 1);
  assert.deepEqual(LOGGED_EDIT_ACTIONS, {
    quotation: ["quotation_updated", "commercial_terms_updated", "enquiry_details_updated", "specification_settings_updated", "document_setup_updated", "extra_discount_updated", "quotation_software_snapshot_saved", "revision_created", "quotation_option_created"],
    quotation_item: ["quotation_item_added", "quotation_item_updated", "quotation_item_restored", "manual_currency_converted", "deleted"],
    quotation_section: ["deleted", "restored"],
  });
});

test("client approved counts only the folders the person created", () => {
  const approved = quote("q1", "QN-0001-001", "A", "2026-02-01T09:00:00.000Z", 100, {
    status: "client_confirmed",
    layout_settings: { project_file: { project_file_id: "p1", project_file_no: "CO-0001-001" } },
  });
  const result = build([approved, quote("q2", "QN-0002-001", "A", "2026-02-02T09:00:00.000Z", 50)]);
  assert.equal(result.A.createdCount, 2);
  assert.ok(result.A.approvedOfCreated <= result.A.createdCount);
});

test("badge Most quotes created: highest wins, a tie shares it, all zero gives none", () => {
  assert.deepEqual([...mostQuotesCreatedIds([{ userId: "a", createdCount: 3 }, { userId: "b", createdCount: 1 }])], ["a"]);
  assert.deepEqual([...mostQuotesCreatedIds([{ userId: "a", createdCount: 2 }, { userId: "b", createdCount: 2 }, { userId: "c", createdCount: 0 }])].sort(), ["a", "b"]);
  assert.equal(mostQuotesCreatedIds([{ userId: "a", createdCount: 0 }, { userId: "b", createdCount: 0 }]).size, 0);
  assert.equal(mostQuotesCreatedIds([]).size, 0);
});

test("amount toggle: created value formats in both modes", () => {
  assert.equal(formatSalesReportAED(97350, "millions"), "AED 0.097M");
  assert.equal(formatSalesReportAED(97350, "full"), "AED 97,350");
});

test("popup numbers and table row come from the same per-member data, and the page uses the new rules", () => {
  assert.ok(page.includes("const selectedContribution = contributionOf(selectedUserId ?? \"\");"));
  assert.ok(page.includes("contributionOf(member.userId).createdCount"));
  assert.ok(page.includes("contributionOf(member.userId).editedCount"));
  assert.ok(page.includes("formatSalesReportAED(contributionOf(member.userId).createdValue, amountMode)"));
  assert.ok(page.includes("formatSalesReportAED(selectedContribution.createdValue, amountMode)"));
  assert.ok(page.includes("{selectedContribution.createdCount}") && page.includes("{selectedContribution.editedCount}") && page.includes("{selectedContribution.approvedOfCreated}"));
  assert.ok(page.includes("Edited (logged)") && page.includes("Only edits recorded in the activity log are counted."));
  assert.ok(page.includes("Most quotes created"));
  assert.ok(!page.includes("Records Worked On</th>\n                      <th className=\"px-5 py-3 text-right font-semibold\">Approved / Completed"));
});

test("Commercial tab, old loaders and permissions are unchanged", () => {
  assert.ok(page.includes("? formatSalesReportAED(member.totalValue, amountMode)"));
  assert.ok(page.includes("? formatSalesReportAED(member.approvedValue, amountMode)"));
  assert.ok(page.includes("{teamView === \"commercial\" ? member.totalQuotations : roleLabel(member.role)}"));
  assert.ok(page.includes("#1 Top performer"));
  const oldLoader = read("lib/settings/profile-stats-loader.ts");
  assert.ok(!oldLoader.includes("team-contribution"));
  // New loader runs only when the (system-owner-only) team stats exist.
  assert.ok(page.includes('profile?.role === "system_owner"\n      ? loadTeamStats(teamDateRange)'));
  assert.ok(page.includes("const teamContribution = teamStats\n    ? await loadTeamContributionStats("));
});
