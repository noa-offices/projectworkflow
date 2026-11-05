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
import { projectSummaries } from "../local-read-cache/projections.js";

const now = new Date().toISOString();
const projectFile = { orderNo: "CO-0003-001", quotationId: "q", quotationNo: "QN-0003-001", clientId: "c", clientName: "Client", reference: "Office", total: 1000, currency: "AED", createdAt: now, createdBy: "rep" };
const quotation = { id: "q", quotation_no: projectFile.quotationNo, client_id: "c", project_id: "p", title: "Office", legacy_reference: "Office", option_no: 1, revision_no: 0, status: "client_confirmed", grand_total: 1000, currency: "AED", salesperson_id: "rep", approved_salesperson_id: "rep", created_by: "rep", created_at: now, quotation_date: now, status_updated_at: now, is_active: true, layout_settings: { projectFile } };
let revised: number | null = null;
const db = {
  async rpc(name: string) { return { data: name === "project_variation_state" ? revised === null ? [] : [{ quotation_id: "q", applied_variation_no: 1, contract_total: revised }] : [{ id: "rep", display_name: "Rep" }], error: null }; },
  from(table: string) {
    const data = table === "quotations" ? [quotation] : table === "profiles" ? [{ id: "rep", full_name: "Rep", role: "sales_designer", email: "rep@example.test", account_status: "active" }] : table === "clients" ? [{ id: "c", company_name: "Client" }] : [];
    const result = () => ({ data, error: null, count: 0 });
    const query = { select() { return query; }, eq() { return query; }, in() { return query; }, or() { return query; }, not() { return query; }, neq() { return query; }, order() { return query; }, limit() { return query; }, gte() { return query; }, lte() { return query; }, lt() { return query; }, filter() { return query; }, returns() { return query; }, maybeSingle: async () => ({ data: data[0] ?? null, error: null }), single: async () => ({ data: data[0] ?? null, error: null }), then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); } };
    return query;
  },
};

function load(path: string, expose: string[] = [], capture?: string) {
  let source = readFileSync(path, "utf8");
  if (capture) {
    const start = source.indexOf(path.includes("sales-report") ? "async function SalesReportContent" : "export default async function");
    const end = source.indexOf("\n  return (", start);
    assert.ok(end > start);
    source = source.slice(0, end) + `\n  return ${capture};\n}\n`;
  }
  source += `\nexport const __test = { ${expose.join(",")} };`;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const testModule = { exports: {} as Record<string, unknown> };
  const auth = async () => ({ user: { id: "rep" }, profile: { role: "designer" }, displayName: "Rep" });
  const modules: Record<string, unknown> = {
    "@/lib/quotation-pricing": pricing,
    "@/lib/projects/project-contract-total": contract,
    "@/lib/projects/one-deal-per-folder": deals,
    "@/lib/projects/project-wise-approved": projectWise,
    "@/lib/quotations/project-file": files,
    "@/lib/quotations/client-approval-draft": approvals,
    "@/lib/quotations/sales-attribution": attribution,
    "@/lib/quotations/project-variation": variation,
    "@/lib/quotations/approval-display": approvalDisplay,
    "@/lib/projectworkflow-numbering": numbering,
    "@/lib/insights/date-ranges": ranges,
    "@/lib/quotations/document-setup": documentSetup,
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/supabase/admin": { createAdminClient: () => ({ client: db }) },
    "@/lib/auth": { requireActiveUser: auth },
    "@/lib/settings/profile-stats-loader": { loadTeamStats: async () => null },
  };
  runInNewContext(code, { module: testModule, exports: testModule.exports, require: (id: string) => modules[id] ?? {}, console, URLSearchParams, Map, Set, Date });
  return testModule.exports as { __test: Record<string, (...args: unknown[]) => Promise<unknown>>; default: (...args: unknown[]) => Promise<unknown> };
}

for (const [path, name] of [
  ["lib/noa/noa-project-capability.server.ts", "allProjectFiles"],
  ["lib/noa/noa-client-capability.server.ts", "clientProjectFiles"],
  ["lib/noa/noa-procurement-capability.server.ts", "allProcurementOrders"],
  ["lib/noa/noa-insights-capability.server.ts", "insightsProjectFiles"],
] as const) test(`${path}: unchanged original and current V1 contract`, async () => {
  const fn = load(path, [name]).__test[name];
  for (const amount of [null, 1200]) {
    revised = amount;
    const rows = await fn(db, "c") as Array<{ total: number }>;
    assert.equal(rows[0].total, amount ?? 1000);
  }
});

test("dashboard summary, sales totals and monthly chart follow V1 while no variation stays identical", async () => {
  const functions = load("lib/dashboard/actions.ts", ["getDashboardStats", "getDashboardSalesData", "getMonthlySalesData"]).__test;
  for (const amount of [null, 1200]) {
    revised = amount;
    assert.equal((await functions.getDashboardStats() as { activeProjectValue: number }).activeProjectValue, amount ?? 1000);
    assert.equal((await functions.getDashboardSalesData() as { yearlyTurnover: number }).yearlyTurnover, amount ?? 1000);
    assert.equal((await functions.getMonthlySalesData() as Array<{ total: number }>).reduce((sum, row) => sum + row.total, 0), amount ?? 1000);
  }
});

test("NOA sales by salesperson follows current Project contract, with unchanged no-variation output", async () => {
  const fn = load("lib/noa/noa-insights-capability.server.ts", ["salesBySalespersonAnswer"]).__test.salesBySalespersonAnswer;
  for (const amount of [null, 1200]) {
    revised = amount;
    const answer = await fn(db, "sales this year") as { data: { rows: Array<{ approvedTotalAed: number }>; deterministicText: string } };
    assert.equal(answer.data.rows[0].approvedTotalAed, amount ?? 1000);
    assert.ok(answer.data.deterministicText.includes(amount === null ? "1,000" : "1,200"));
  }
});

test("sales report approved amounts change; quoted amounts do not", async () => {
  const fn = load("app/insights/sales-report/page.tsx", ["SalesReportContent"], "{ kpiCurrent, repStats }").__test.SalesReportContent;
  for (const amount of [null, 1200]) {
    revised = amount;
    const report = await fn({ searchParams: Promise.resolve({ range: "this_year" }), auth: { profile: { role: "designer" } } }) as { kpiCurrent: { approvedAmount: number; totalQuotedAmount: number }; repStats: Array<{ currentApprovedAmount: number }> };
    assert.equal(report.kpiCurrent.approvedAmount, amount ?? 1000);
    assert.equal(report.kpiCurrent.totalQuotedAmount, 1000);
    assert.equal(report.repStats[0].currentApprovedAmount, amount ?? 1000);
  }
});

test("sales approvals use current Project value and preserve quotation document total", async () => {
  const fn = load("app/sales/approvals/page.tsx", [], "approvedQuotations").default;
  for (const amount of [null, 1200]) {
    revised = amount;
    const rows = await fn({ searchParams: Promise.resolve({}) }) as Array<{ contractValue: number; grand_total: number }>;
    assert.equal(rows[0].contractValue, amount ?? 1000);
    assert.equal(rows[0].grand_total, 1000);
  }
});

test("profile team approved statistics use revised totals and keep quoted value original", async () => {
  const functions = load("lib/settings/profile-stats-loader.ts", ["loadTeamStats", "loadProfileStats"]).__test;
  for (const amount of [null, 1200]) {
    revised = amount;
    const team = await functions.loadTeamStats() as Array<{ approvedValue: number; totalValue: number }>;
    assert.equal(team[0].approvedValue, amount ?? 1000);
    assert.equal(team[0].totalValue, 1000);
    const profile = await functions.loadProfileStats("rep", null, "sales_designer") as { projects: Array<{ approvedValue: number; quotedValue: number }> };
    assert.equal(profile.projects[0].approvedValue, amount ?? 1000);
    assert.equal(profile.projects[0].quotedValue, 1000);
  }
});

test("cache projection contains current value; stale saved Project previews cannot display cached money", () => {
  assert.equal(projectSummaries([quotation], new Map(), false)[0].total, 1000);
  assert.equal(projectSummaries([quotation], new Map(), false, new Map([["q", { applied_variation_no: 1, contract_total: 1200 }]]))[0].total, 1200);
  const surface = readFileSync("components/local-read-cache/read-surface.tsx", "utf8");
  assert.match(surface, /const cachedProject = entity === "projects" \|\| entity === "completed"/);
  assert.match(surface, /!cachedProject && row.total !== undefined/);
});

test("all four Project and procurement lists share the batched order-number adapter", async () => {
  for (const amount of [null, 1200]) {
    revised = amount;
    assert.equal((await contract.loadProjectContractTotalsByOrder(db, [quotation])).get(projectFile.orderNo), amount ?? 1000);
  }
  for (const file of ["app/projects/orders/page.tsx", "app/projects/completed/page.tsx", "app/procurement/orders/page.tsx", "app/procurement/completed/page.tsx"]) {
    assert.match(readFileSync(file, "utf8"), /await loadProjectContractTotalsByOrder\(supabase, quotations \?\? \[\]\)/);
  }
});
