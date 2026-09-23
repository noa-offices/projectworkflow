import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-insights-capability.server.ts and noa-orchestrator.ts have "@/..." aliases and/or
// `import "server-only"`, neither resolvable by Node's plain ESM resolver outside the Next.js
// build. These are source-level wiring/safety checks, not runtime execution tests, matching the
// convention already used throughout lib/noa/'s other *-safety.test.mts files.

const insightsSource = readFileSync("lib/noa/noa-insights-capability.server.ts", "utf8");
const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const typesSource = readFileSync("lib/noa/noa-types.ts", "utf8");

const MUTATION_PATTERN = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;

// 1. requireActiveUser() exists
test("1. Insights capability calls requireActiveUser() as its primary gate", () => {
  assert.ok(insightsSource.includes('import { requireActiveUser, requireProcurementManager, requireProductLibraryManager } from "@/lib/auth";'));
  assert.ok(insightsSource.includes("await requireActiveUser();"));
});

// 2. user-scoped client only
test("2. only the user-scoped Supabase client is used", () => {
  assert.ok(insightsSource.includes('import { createClient } from "@/lib/supabase/server";'));
});

// 3. NO createAdminClient
test("3. no createAdminClient anywhere", () => {
  assert.ok(!insightsSource.includes("createAdminClient"));
});

// 4. no service role
test("4. no service-role access anywhere", () => {
  assert.ok(!/service[-_]?role|SUPABASE_SERVICE_ROLE/i.test(insightsSource));
});

// 5. no writes
test("5. no mutation method calls", () => {
  assert.ok(!MUTATION_PATTERN.test(insightsSource));
});

// 6. deterministic aggregation exists
test("6. counts/totals are aggregated in code from bounded reads, never handed to the model to tally", () => {
  assert.ok(insightsSource.includes("statusCounts.set(") || insightsSource.includes("totalsByCurrency.set("));
  assert.ok(!insightsSource.includes('.select("*")'));
});

// 7. quotation totals grouped by currency
test("7. quotation totals are grouped by currency, never summed across currencies", () => {
  assert.ok(insightsSource.includes("totalsByCurrency"));
  assert.ok(insightsSource.includes("formatCurrencyTotals"));
  assert.ok(!/grand_total\s*\+\s*grand_total|sum.*all.*currenc/i.test(insightsSource));
});

// 8. no invented currency conversion
test("8. no currency conversion/exchange-rate logic exists", () => {
  assert.ok(!/exchangeRate|fxRate|convertCurrency|conversionRate/i.test(insightsSource));
});

// 9. quotation statuses use authoritative values
test("9. quotation status counts are read directly from the status column, never an invented alias map", () => {
  assert.ok(!/const\s+STATUS_ALIASES/i.test(insightsSource));
  assert.ok(insightsSource.includes("row.status"));
});

// 10. project statuses use exact 4-value vocabulary
test("10. project status vocabulary is exactly active/on_hold/completed/cancelled", () => {
  assert.match(insightsSource, /const PROJECT_STATUSES = \["active", "on_hold", "completed", "cancelled"\] as const;/);
});

// 11. is_active separate from project_status
test("11. is_active (archive state) is computed independently from project_status counts", () => {
  assert.ok(insightsSource.includes('.eq("is_active", true)') && insightsSource.includes('.eq("is_active", false)'));
  assert.ok(insightsSource.includes('.eq("project_status", status)'));
});

// 12. Product price summary calls existing price-state helper
test("12. product price summary reuses productTemplatePriceCheckState(), never reimplemented", () => {
  assert.ok(insightsSource.includes('import {\n  brandPriceBaselineDate,\n  latestBrandPriceListUpdate,\n  productTemplatePriceCheckState,') || insightsSource.includes("productTemplatePriceCheckState,"));
  assert.ok(insightsSource.includes("productTemplatePriceCheckState({"));
});

// 13. Product permission is preserved
test("13. product/price insights require requireProductLibraryManager() before any product_templates read", () => {
  const kindCheckIndex = insightsSource.indexOf('kind === "product_price_summary"');
  const requireIndex = insightsSource.indexOf("await requireProductLibraryManager();", kindCheckIndex);
  const queryIndex = insightsSource.indexOf("productPriceSummaryAnswer(supabase)", kindCheckIndex);
  assert.ok(kindCheckIndex >= 0 && requireIndex >= 0 && queryIndex >= 0 && requireIndex < queryIndex);
});

// 14. Procurement permission is preserved
test("14. procurement insights require requireProcurementManager() before any procurement-order read", () => {
  const kindCheckIndex = insightsSource.indexOf('kind === "procurement_summary"');
  const requireIndex = insightsSource.indexOf("await requireProcurementManager();", kindCheckIndex);
  const queryIndex = insightsSource.indexOf("procurementSummaryAnswer(supabase)", kindCheckIndex);
  assert.ok(kindCheckIndex >= 0 && requireIndex >= 0 && queryIndex >= 0 && requireIndex < queryIndex);
});

// 15. no employee ranking/performance logic
test("15. no employee ranking, salesperson performance, or attendance/working-hours logic exists", () => {
  assert.ok(!/bestSalesperson|salesperson_id|employeeRanking|scorecard|workingHours|hoursWorked|attendance/i.test(insightsSource));
});

// 16. trend range bounded
test("16. quotation trend is bounded to MAX_TREND_MONTHS", () => {
  assert.match(insightsSource, /const MAX_TREND_MONTHS = 12;/);
  assert.ok(insightsSource.includes("MAX_TREND_MONTHS - 1"));
});

// 17. raw result payload bounded
test("17. quotation/price scans are hard-capped", () => {
  assert.match(insightsSource, /const MAX_QUOTATION_SCAN = 300;/);
  assert.match(insightsSource, /const MAX_PRICE_SCAN = 200;/);
  assert.ok(insightsSource.includes(".limit(MAX_QUOTATION_SCAN)"));
  assert.ok(insightsSource.includes(".limit(MAX_PRICE_SCAN)"));
});

// 18. deterministicText exists
test("18. every Insights result path emits deterministicText", () => {
  const count = (insightsSource.match(/deterministicText:/g) ?? []).length;
  assert.ok(count >= 7, "expected deterministicText across quotation/trend/project/product-price/client/procurement/overview branches");
});

// 19. orchestrator dispatches Insights
test("19. orchestrator dispatches to fetchNoaInsightsCapability for the Insights domain", () => {
  assert.ok(orchestratorSource.includes('import { fetchNoaInsightsCapability } from "@/lib/noa/noa-insights-capability.server";'));
  assert.match(orchestratorSource, /domain === "Insights"\s*\n\s*\? await fetchNoaInsightsCapability\(request\.message, request\.context\)/);
});

// 20. unauthorized capability result prevents provider call
test("20. an unauthorized result returns before any Supabase query runs, and before the provider is ever called", () => {
  assert.ok(insightsSource.includes("UNAUTHORIZED_RESULT"));
  const catchIndex = insightsSource.indexOf("if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;");
  const supabaseCreateIndex = insightsSource.indexOf("const supabase = await createClient();");
  assert.ok(catchIndex >= 0 && supabaseCreateIndex >= 0 && catchIndex < supabaseCreateIndex);

  const capabilityResultIndex = orchestratorSource.indexOf("const capabilityResult");
  const notOkIndex = orchestratorSource.indexOf("if (!capabilityResult.ok)");
  const providerCallIndex = orchestratorSource.indexOf("runNoaProvider(");
  assert.ok(capabilityResultIndex < notOkIndex && notOkIndex < providerCallIndex);
});

// 21. no admin/system data reads
test("21. no admin/system settings tables are read from Insights", () => {
  assert.ok(!insightsSource.includes('.from("profiles")'));
  assert.ok(!insightsSource.includes('.from("ai_provider_settings")'));
  assert.ok(!insightsSource.includes('.from("ai_agent_settings")'));
});

// 22. no user-activity/attendance logic
test("22. no user-activity/audit-log/attendance reads exist in Insights", () => {
  assert.ok(!insightsSource.includes('.from("audit_activity_log")'));
  assert.ok(!/attendance|clock.?in|working hours/i.test(insightsSource));
});

test("Insights is a real NoaDomain", () => {
  assert.match(typesSource, /export type NoaDomain = "Product" \| "Quotation" \| "Price" \| "Project" \| "Client" \| "Procurement" \| "UserActivity" \| "Admin" \| "Insights" \| "Help";/);
});

test("overview never elevates access: a Product/Procurement permission failure inside overviewAnswer is caught, not thrown or bypassed", () => {
  assert.ok(insightsSource.includes("unavailable with your current permissions"));
  const overviewStart = insightsSource.indexOf("async function overviewAnswer");
  const overviewEnd = insightsSource.indexOf("\n}\n", insightsSource.indexOf("sources: [{ label: \"Insights · Calculated from your authorized ProjectWorkflow records", overviewStart));
  const overviewSection = insightsSource.slice(overviewStart, overviewEnd);
  assert.ok(overviewSection.includes("requireProductLibraryManager()"));
  assert.ok(overviewSection.includes("requireProcurementManager()"));
  assert.ok(overviewSection.includes("catch (error)"));
});

test("no cross-capability chaining: Insights capability never imports another NOA capability", () => {
  assert.ok(!insightsSource.includes("noa-product-capability"));
  assert.ok(!insightsSource.includes("noa-quotation-capability"));
  assert.ok(!insightsSource.includes("noa-price-capability"));
  assert.ok(!insightsSource.includes("noa-project-capability"));
  assert.ok(!insightsSource.includes("noa-client-capability"));
  assert.ok(!insightsSource.includes("noa-procurement-capability"));
  assert.ok(!insightsSource.includes("noa-user-activity-capability"));
  assert.ok(!insightsSource.includes("noa-admin-capability"));
});

test("no direct provider call inside the capability - only the orchestrator invokes it", () => {
  assert.ok(!insightsSource.includes("runAiProvider"));
  assert.ok(!insightsSource.includes("runNoaProvider"));
});
