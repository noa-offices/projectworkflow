import assert from "node:assert/strict";
import { test } from "node:test";
import { projectSummaries, quotationGroupCondition, quotationSummaries, type SummaryQuotation } from "./projections";
const base: SummaryQuotation = {
  id: "q1", client_id: "c1", project_id: null, quotation_no: "QN-2026-001", title: "Root",
  legacy_reference: "Reference", quotation_date: "2026-01-01", status: "draft",
  currency: "AED", grand_total: 100, is_active: true, approved_salesperson_id: null, layout_settings: {},
};
const names = new Map([["c1", "Company"]]);
function order(orderNo = "OR-1") {
  return { orderNo, quotationId: "q1", quotationNo: "QN-2026-001", folderNo: "QF-2026-001", clientId: "c1", clientName: "Old name", reference: "Project",
    total: 100, currency: "AED", createdAt: "2026-01-01", createdBy: "u1", status: "Confirmed", approvalNo: "AP-1", source: "quotation_layout_settings" };
}
test("folder dedup keeps latest active representative and counted statuses", () => {
  const rows = quotationSummaries([base, { ...base, id: "q2", quotation_no: "QN-2026-001-R1", title: "Revision", quotation_date: "2026-02-01" },
    { ...base, id: "q3", quotation_no: "QN-2026-001-OPT1", is_active: false, quotation_date: "2026-03-01" }], names, new Map());
  assert.equal(rows.length, 1); assert.equal(rows[0].code, "QF-2026-001");
  assert.equal(rows[0].title, "Revision"); assert.equal(rows[0].count, 3);
  assert.match(rows[0].status, /Draft x2/); assert.match(rows[0].status, /Archived/);
});
test("archive and approval-pending semantics survive minimized projection", () => {
  const result = quotationSummaries([{ ...base, status: "client_confirmed", layout_settings: { folderArchivedAt: "2026-01-02", heavy: "do not persist" } }], names, new Map());
  assert.equal(result[0].archived, true); assert.match(result[0].status, /Project File Pending/);
  assert.ok(!JSON.stringify(result).includes("heavy")); assert.ok(!JSON.stringify(result).includes("layout_settings"));
});
test("sibling condition is deterministic and batchable including Project fallback", () => {
  assert.equal(quotationGroupCondition(base), "quotation_no.ilike.QN-2026-001*");
  assert.equal(quotationGroupCondition({ ...base, quotation_no: null, project_id: "p1" }), "project_id.eq.p1");
});
test("Project orderNo dedup keeps first representative and resolves company", () => {
  const rows = projectSummaries([{ id: "q1", layout_settings: { projectFile: order() } },
    { id: "q2", layout_settings: { projectFile: { ...order(), reference: "Duplicate" } } }], names, false);
  assert.equal(rows.length, 1); assert.equal(rows[0].title, "Project"); assert.equal(rows[0].subtitle, "Company");
  assert.equal(rows[0].code, "OR-1"); assert.ok(!JSON.stringify(rows).includes("createdBy"));
});
test("completed/cancelled grouping preserved without caching heavy snapshots", () => {
  const input = [{ id: "q1", layout_settings: { projectFile: order("OR-1"), projectCompletedAt: "2026-03-01", heavy: { private: true } } },
    { id: "q2", layout_settings: { projectFile: order("OR-2"), projectCancelledAt: "2026-03-02" } }];
  assert.equal(projectSummaries(input, names, false).length, 0);
  const completed = projectSummaries(input, names, true);
  assert.equal(completed.length, 1); assert.equal(completed[0].status, "Completed");
  assert.ok(!JSON.stringify(completed).includes("private"));
});
