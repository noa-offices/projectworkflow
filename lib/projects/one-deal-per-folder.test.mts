import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as contract from "./project-contract-total.js";
import * as pricing from "../quotation-pricing.js";
import * as deals from "./one-deal-per-folder.js";
import * as projectWise from "./project-wise-approved.js";
import * as files from "../quotations/project-file.js";
import * as approvals from "../quotations/client-approval-draft.js";
import * as attribution from "../quotations/sales-attribution.js";
import * as variation from "../quotations/project-variation.js";
import * as approvalDisplay from "../quotations/approval-display.js";
import * as numbering from "../projectworkflow-numbering.js";
import * as ranges from "../insights/date-ranges.js";
import * as documentSetup from "../quotations/document-setup.js";

const now = new Date().toISOString();
const file = (orderNo: string, quotationNo: string, id: string, total: number) => ({ orderNo, quotationId: id, quotationNo, clientId: "c", clientName: "Client", reference: "Office", total, currency: "AED", createdAt: now, createdBy: "rep" });
const link = { orderNo: "CO-0002-001", projectQuotationId: "B", snapshotId: "s", variationNo: 1, baseRevisionNo: 0 };
const row = (id: string, no: string, grand: number, layout: object, extra: object = {}) => ({
  id, quotation_no: no, client_id: "c", project_id: null, title: "T", legacy_reference: "T", option_no: 1, revision_no: 0, status: "client_confirmed", grand_total: grand, currency: "AED",
  salesperson_id: "rep1", approved_salesperson_id: "rep1", created_by: "rep1", created_at: now, quotation_date: now, status_updated_at: now, is_active: true, layout_settings: layout, ...extra,
});
/** The live case: two Projects, an old confirmed revision of the second, and its variation. */
const liveRows = () => [
  row("A", "QN-0006-001", 96265, { projectFile: file("CO-0006-001", "QN-0006-001", "A", 96265) }),
  row("B", "QN-0002-001", 22800, { projectFile: file("CO-0002-001", "QN-0002-001", "B", 22800) }, { approved_salesperson_id: "rep2", salesperson_id: "rep2" }),
  row("C", "QN-0002-001-R2", 25575.9, {}, { revision_no: 2, approved_salesperson_id: "rep2", salesperson_id: "rep2" }),
  row("D", "QN-0002-001-V1", 1148.4, { variationOf: link }),
];
const states = new Map([["B", { applied_variation_no: 1, contract_total: 23948.4 }]]);

test("the live case: a Project folder with an old confirmed revision and a variation is ONE deal at the current contract", () => {
  const result = deals.oneDealPerFolder(liveRows(), states);
  assert.deepEqual(result.map((deal) => deal.row.id), ["A", "B"]);
  assert.equal(Number(result.reduce((sum, deal) => sum + deal.value, 0).toFixed(2)), 120213.4);
  assert.equal(result[1].row.approved_salesperson_id, "rep2", "the Project's own quotation decides the salesperson");
});

test("a folder without a Project: the latest confirmed revision wins, at its own grand total", () => {
  const result = deals.oneDealPerFolder([row("r0", "QN-0009-001", 100, {}), row("r2", "QN-0009-001-R2", 300, {}, { revision_no: 2 }), row("r1", "QN-0009-001-R1", 200, {}, { revision_no: 1 })], new Map());
  assert.deepEqual(result.map((deal) => [deal.row.id, deal.value, deal.hasProject]), [["r2", 300, false]]);
});

test("a folder with only a variation is no deal; a credit variation lowers the one deal; a normal folder is unchanged", () => {
  assert.deepEqual(deals.oneDealPerFolder([row("D", "QN-0002-001-V1", 5, { variationOf: link })], new Map()), []);
  const credit = deals.oneDealPerFolder([liveRows()[1]], new Map([["B", { applied_variation_no: 1, contract_total: 20000 }]]));
  assert.equal(credit[0].value, 20000);
  const normal = deals.oneDealPerFolder([row("N", "QN-0010-001", 500, { projectFile: file("CO-0010-001", "QN-0010-001", "N", 500) }), row("M", "QN-0011-001", 700, {})], new Map());
  assert.deepEqual(normal.map((deal) => deal.value), [500, 700]);
});

// ---- Dashboard and Sales Report with the live case ----

let fixture = liveRows();
const db = {
  async rpc(name: string) { return { data: name === "project_variation_state" ? [{ quotation_id: "B", applied_variation_no: 1, contract_total: 23948.4 }] : [{ id: "rep1", display_name: "Rep 1" }], error: null }; },
  from(table: string) {
    const data = table === "quotations" ? fixture : table === "profiles" ? [{ id: "rep1", full_name: "Rep 1", role: "sales_designer", email: "r1@example.test", account_status: "active" }, { id: "rep2", full_name: "Rep 2", role: "sales_designer", email: "r2@example.test", account_status: "active" }] : [];
    const query = { select() { return query; }, eq() { return query; }, in() { return query; }, or() { return query; }, not() { return query; }, neq() { return query; }, order() { return query; }, limit() { return query; }, gte() { return query; }, lte() { return query; }, lt() { return query; }, filter() { return query; }, returns() { return query; }, maybeSingle: async () => ({ data: data[0] ?? null, error: null }), single: async () => ({ data: data[0] ?? null, error: null }), then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data, error: null, count: data.length }).then(resolve); } };
    return query;
  },
};
function load(path: string, expose: string[] = [], capture?: string) {
  let source = readFileSync(path, "utf8");
  if (capture) {
    const start = source.indexOf(path.includes("approvals") ? "export default async function" : "async function SalesReportContent");
    const end = source.indexOf("\n  return (", start);
    assert.ok(end > start);
    source = source.slice(0, end) + `\n  return ${capture};\n}\n`;
  }
  source += `\nexport const __test = { ${expose.join(",")} };`;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const testModule = { exports: {} as Record<string, unknown> };
  const modules: Record<string, unknown> = {
    "@/lib/quotation-pricing": pricing, "@/lib/projects/project-contract-total": contract, "@/lib/projects/one-deal-per-folder": deals, "@/lib/projects/project-wise-approved": projectWise,
    "@/lib/quotations/project-file": files, "@/lib/quotations/client-approval-draft": approvals, "@/lib/quotations/sales-attribution": attribution, "@/lib/quotations/project-variation": variation,
    "@/lib/quotations/approval-display": approvalDisplay, "@/lib/projectworkflow-numbering": numbering, "@/lib/insights/date-ranges": ranges, "@/lib/quotations/document-setup": documentSetup,
    "@/lib/supabase/server": { createClient: async () => db }, "@/lib/supabase/admin": { createAdminClient: () => ({ client: db }) },
    "@/lib/auth": { requireActiveUser: async () => ({ user: { id: "rep1" }, profile: { role: "designer" }, displayName: "Rep" }) },
    "@/lib/settings/profile-stats-loader": { loadTeamStats: async () => null },
  };
  runInNewContext(code, { module: testModule, exports: testModule.exports, require: (id: string) => modules[id] ?? {}, console, URLSearchParams, Map, Set, Date });
  return testModule.exports as { __test: Record<string, (...args: unknown[]) => Promise<unknown>>; default: (...args: unknown[]) => Promise<unknown> };
}

test("dashboard, live case: 2 folders, AED 120,213.40, 2 deals in total; Active project value unchanged", async () => {
  fixture = liveRows();
  const functions = load("lib/dashboard/actions.ts", ["getDashboardStats", "getDashboardSalesData", "getMonthlySalesData"]).__test;
  const sales = await functions.getDashboardSalesData() as { yearlyTurnover: number; dealCount: number; salesByPerson: Array<{ salesperson_id: string; deal_count: number; total: number }> };
  assert.equal(Number(sales.yearlyTurnover.toFixed(2)), 120213.4);
  assert.equal(sales.dealCount, 2);
  assert.equal(JSON.stringify(sales.salesByPerson.map((person) => [person.salesperson_id, person.deal_count]).sort()), JSON.stringify([["rep1", 1], ["rep2", 1]]));
  const monthly = await functions.getMonthlySalesData() as Array<{ total: number }>;
  assert.equal(Number(monthly.reduce((sum, month) => sum + month.total, 0).toFixed(2)), 120213.4);
  const stats = await functions.getDashboardStats() as { activeProjectValue: number };
  assert.equal(Number(stats.activeProjectValue.toFixed(2)), 120213.4);
});

test("the dashboard text counts folders", () => {
  const source = readFileSync("components/dashboard/erp-dashboard.tsx", "utf8");
  assert.equal(source.match(/client-confirmed quotation folder/g)?.length, 2);
  assert.ok(!/client-confirmed quotation\{/.test(source) && !/client-confirmed quotation\$\{/.test(source));
});

for (const [name, extra] of [["the live case", []], ["two salespeople, three Projects", [row("E", "QN-0012-001", 5000.5, { projectFile: file("CO-0012-001", "QN-0012-001", "E", 5000.5) }, { approved_salesperson_id: "rep1" })]]] as const) {
  test(`sales report: the Project-wise total equals the Client approved value (${name})`, async () => {
    fixture = [...liveRows(), ...extra];
    const fn = load("app/insights/sales-report/page.tsx", ["SalesReportContent"], "{ kpiCurrent, projectWiseRows }").__test.SalesReportContent;
    const report = await fn({ searchParams: Promise.resolve({ range: "this_year" }), auth: { profile: { role: "designer" } } }) as { kpiCurrent: { approvedAmount: number; approvedCount: number }; projectWiseRows: Array<{ currentContract: number; projectNo: string; variations: number | null; originalContract: number }> };
    const total = report.projectWiseRows.reduce((sum, r) => sum + r.currentContract, 0);
    assert.equal(Number(total.toFixed(2)), Number(report.kpiCurrent.approvedAmount.toFixed(2)));
    assert.equal(report.projectWiseRows.length, report.kpiCurrent.approvedCount);
    const second = report.projectWiseRows.find((r) => r.projectNo === "CO-0002-001")!;
    assert.deepEqual([second.originalContract, second.currentContract, second.variations], [22800, 23948.4, 1148.4]);
    assert.equal(report.projectWiseRows.find((r) => r.projectNo === "CO-0006-001")!.variations, null);
  });
}

test("the report cards carry the two grey lines and the table sits below the team table", () => {
  const page = readFileSync("app/insights/sales-report/page.tsx", "utf8").replace(/\r\n/g, "\n");
  assert.ok(page.includes("Latest quotation per folder") && page.includes("Current Project contract value (includes variations)"));
  assert.ok(page.indexOf("<SalesTeamPerformanceTable") < page.indexOf("<ProjectWiseApprovedTable"));
});

test("Approved Quotations page, live case: one row per folder, current contract totals, a variation line only where one is applied", async () => {
  fixture = liveRows();
  const fn = load("app/sales/approvals/page.tsx", [], "approvedQuotations").default;
  const rows = await fn({ searchParams: Promise.resolve({}) }) as Array<{ quotation_no: string; contractValue: number; variationNote: string | null }>;
  assert.equal(JSON.stringify(rows.map((r) => [r.quotation_no, r.contractValue])), JSON.stringify([["QN-0006-001", 96265], ["QN-0002-001", 23948.4]]));
  assert.equal(rows[0].variationNote, null);
  assert.equal(rows[1].variationNote, "Original AED 22,800 · +AED 1,148.40 (V1)");
  fixture = [row("r1", "QN-0009-001-R1", 200, {}, { revision_no: 1 }), row("r2", "QN-0009-001-R2", 300, {}, { revision_no: 2 }), row("N", "QN-0010-001", 500, { projectFile: file("CO-0010-001", "QN-0010-001", "N", 500) })];
  const others = await fn({ searchParams: Promise.resolve({}) }) as Array<{ quotation_no: string; contractValue: number; variationNote: string | null }>;
  assert.equal(JSON.stringify(others.map((r) => [r.quotation_no, r.contractValue, r.variationNote])), JSON.stringify([["QN-0009-001-R2", 300, null], ["QN-0010-001", 500, null]]));
});

test("Approved Quotations page: the subtitle counts folders; title, description and links are unchanged", () => {
  const page = readFileSync("app/sales/approvals/page.tsx", "utf8").split(String.fromCharCode(13)).join("");
  assert.ok(page.includes('approved {approvedQuotations.length === 1 ? "quotation folder" : "quotation folders"} marked'));
  assert.ok(page.includes('title="Approved Quotations"') && page.includes("Quotations marked Client Approved. Project files can be opened or created from approved quotations."));
  assert.ok(page.includes("Open Quotation") && page.includes("Open Project File"));
});
