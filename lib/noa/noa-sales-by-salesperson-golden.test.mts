import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const insights = readFileSync("lib/noa/noa-insights-capability.server.ts", "utf8").replace(/\r\n/g, "\n");
const tools = readFileSync("lib/noa/v2/noa-agent-tools.server.ts", "utf8").replace(/\r\n/g, "\n");

const answerBody = () => {
  const start = insights.indexOf("async function salesBySalespersonAnswer(");
  assert.ok(start > -1, "salesBySalespersonAnswer exists");
  return insights.slice(start, insights.indexOf("\n}\n", start));
};
const entryBody = () => insights.slice(insights.indexOf("export async function fetchNoaInsightsCapability("));

test("sales_by_salesperson is reached by a structured option, not by message wording", () => {
  const entry = entryBody();
  assert.ok(entry.includes('options: { report?: "sales_by_salesperson" } = {}'), "one closed optional input");
  assert.ok(entry.includes('options.report === "sales_by_salesperson"'));
  assert.ok(!insights.includes('"sales_by_salesperson" |') && !/\/\\b[^\n]*salesperson[^\n]*\/\.test\(normalized\)/.test(insights), "no new classifier phrase");
});

test("the report is behind requireSettingsManager() and a non-manager reads no rows", () => {
  const entry = entryBody();
  const gateIndex = entry.indexOf("await requireSettingsManager();");
  const readIndex = entry.indexOf("return salesBySalespersonAnswer(supabase, message);");
  assert.ok(gateIndex > -1 && readIndex > gateIndex);
  assert.ok(entry.slice(gateIndex, readIndex).includes("return SALES_REPORT_UNAUTHORIZED_RESULT;"));
  assert.ok(insights.includes("SALES_REPORT_UNAUTHORIZED_RESULT: NoaCapabilityResult"));
  assert.ok(insights.includes("requireSettingsManager"));
});

test("only the signed-in user's client is used: no admin client anywhere in the capability", () => {
  assert.ok(!/createAdminClient/.test(insights));
  assert.ok(!/createAdminClient/.test(answerBody()));
});

test("the approval rule and names are reused, not rewritten", () => {
  const body = answerBody();
  assert.ok(insights.includes('from "@/lib/quotations/sales-attribution"'));
  assert.ok(body.includes("actualApprovedQuotationsByFolder("));
  assert.ok(!body.includes('"client_confirmed"') && !body.includes("hasQualifyingProjectFile"), "no second approval rule");
  assert.ok(body.includes('supabase.rpc("list_commission_sales_managers")'));
  assert.ok(body.includes("Unresolved salesperson") && body.includes("Owner attribution pending"));
});

test("non-AED rows are never added into the AED total", () => {
  const body = answerBody();
  const otherBranch = body.slice(body.indexOf('if (row.currency !== "AED")'));
  assert.ok(otherBranch.includes("otherCurrencyTotals.set(") && otherBranch.indexOf("continue;") < otherBranch.indexOf("byPerson.set("), "non-AED rows are routed to their own line and skip the AED totals");
  assert.ok(/AED \$\{/.test(body) || body.includes('`AED '));
});

test("the scan cap is stated and the existing date helpers are reused", () => {
  const body = answerBody();
  assert.ok(body.includes("MAX_QUOTATION_SCAN") && body.includes("showing the first"));
  assert.ok(body.includes("insightsDateRangeKey(message)") && body.includes("resolveDateRange(rangeKey, undefined, undefined)"));
  assert.ok(body.includes('.eq("is_active", true)'));
});

test("v2 adds one closed report value that sends the structured option", () => {
  assert.ok(tools.includes("sales_by_salesperson"));
  assert.ok(tools.includes('{ report: "sales_by_salesperson" }'));
  assert.ok(tools.includes("fetchNoaInsightsCapability("));
});

test("existing insight reports are unchanged", () => {
  for (const line of [
    'if (kind === "quotation_summary") return quotationSummaryAnswer(supabase, message);',
    'if (kind === "quotation_analytics") return quotationAnalyticsAnswer(supabase, message);',
    'if (kind === "client_ranking") return clientRankingAnswer(supabase, message);',
    'if (kind === "project_file_analytics") return projectFileAnalyticsAnswer(supabase);',
  ]) assert.ok(insights.includes(line), line);
  assert.ok(insights.includes('.select("created_at,currency,grand_total,status", { count: "exact" })'));
  assert.ok(insights.includes("await requireProductLibraryManager();") && insights.includes("await requireProcurementManager();"));
});
