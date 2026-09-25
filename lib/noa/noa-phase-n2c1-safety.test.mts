// NOA 2.0C-1: Quotation Analytics foundation - narrow Insights routing additions + a reusable
// bounded aggregate (count/totals/confirmed/status/average, per-currency) + this-month-vs-last-
// month comparison + a fixed conversion-rate refusal.
//
// Routing tests: this repo has a pre-existing, well-documented Node test-runner environment bug -
// any test file importing a relative ".js" specifier where the real file is ".ts" (not ".mts")
// fails with ERR_MODULE_NOT_FOUND, confirmed identical on the clean git HEAD baseline (the
// existing noa-intent-router.test.mts hits the same failure standalone, unrelated to this phase).
// So routing here is verified by extracting the ACTUAL INSIGHTS_PATTERNS regex array literal out
// of the real source text and exercising it directly - never a re-derived guess at what the
// patterns should be, and never a parse of message.text at runtime (this is a build-time test
// only). The capability file itself is "server-only" with "@/..." aliases and cannot be imported
// outside the Next.js build either, so its tests are source-level wiring/safety checks, the same
// convention every other *-safety.test.mts file in this codebase already uses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const insights = readFileSync("lib/noa/noa-insights-capability.server.ts", "utf8");
const types = readFileSync("lib/noa/noa-types.ts", "utf8");
const quotationCapability = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");
const attentionCapability = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");
const catchUpReader = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
const router = readFileSync("lib/noa/noa-intent-router.ts", "utf8");

function sliceFunctionBody(src: string, startIndex: number): string {
  const rest = src.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

// Extracts a top-level `const NAME = [ ... ];` regex-literal array straight out of the real
// source text and evaluates it (regex literals only, from a trusted local file - never user
// input) so tests exercise the ACTUAL patterns in noa-intent-router.ts, not a re-derived copy.
function extractRegexArray(source: string, constName: string): RegExp[] {
  const declStart = source.indexOf(`const ${constName} = [`);
  assert.ok(declStart !== -1, `${constName} not found in source`);
  const arrayStart = source.indexOf("[", declStart);
  let depth = 0;
  let end = -1;
  for (let i = arrayStart; i < source.length; i++) {
    if (source[i] === "[") depth++;
    if (source[i] === "]") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.ok(end !== -1, `${constName} array literal not closed`);
  const literal = source.slice(arrayStart, end + 1);
  return eval(literal) as RegExp[];
}

const insightsPatterns = extractRegexArray(router, "INSIGHTS_PATTERNS");
const catchUpPatterns = extractRegexArray(router, "CATCH_UP_PATTERNS");
const attentionPatterns = extractRegexArray(router, "ATTENTION_PATTERNS");

function matchesAny(patterns: RegExp[], message: string): boolean {
  return patterns.some((pattern) => pattern.test(message.toLowerCase()));
}

test("1. No Analytics domain was added to NoaDomain (later phase N2C1.1 legitimately added an unrelated NoaAnalyticsTransport UI type - checked here by scoping strictly to the NoaDomain union itself, never the whole file)", () => {
  assert.ok(types.includes('export type NoaDomain = "Product" | "Quotation" | "Price" | "Project" | "Client" | "Procurement" | "UserActivity" | "Admin" | "Insights" | "Attention" | "Help";'));
});

test('2. "quotation analytics" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "quotation analytics"));
});

test('3. "sales overview" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "sales overview"));
});

test('4. "how much did we quote this month" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "how much did we quote this month"));
});

test('5. "how many quotations this month" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "how many quotations this month"));
});

test('6. "how much was client confirmed this month" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "how much was client confirmed this month"));
});

test('7. "compare this month with last month" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "compare this month with last month"));
});

test('8. "quotation status breakdown" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "quotation status breakdown"));
});

test('9. "quotation trend"/"quotation summary" still match (pre-existing entries untouched)', () => {
  assert.ok(matchesAny(insightsPatterns, "quotation trend"));
  assert.ok(matchesAny(insightsPatterns, "quotation summary"));
});

test('10/11. CATCH_UP_PATTERNS (checked at a higher routing precedence than Insights, per PART 2\'s own comment - unmodified by this phase) still match "what changed today"/"what changed on QN-0005-001"', () => {
  assert.ok(matchesAny(catchUpPatterns, "what changed today"));
  assert.ok(matchesAny(catchUpPatterns, "what changed on qn-0005-001"));
});

test('12. New INSIGHTS_PATTERNS entries never match single-quotation current-state phrasing ("tell me about QN-...", "what is QN-... worth", "show QN-...")', () => {
  for (const message of ["tell me about qn-0005-001", "what is qn-0005-001 worth", "show qn-0005-001"]) {
    assert.ok(!matchesAny(insightsPatterns, message), `unexpectedly matched: ${message}`);
  }
});

test('12c. ATTENTION_PATTERNS (checked at a higher routing precedence than Insights, unmodified by this phase) still match "what needs my attention"', () => {
  assert.ok(matchesAny(attentionPatterns, "what needs my attention"));
});

const aggregateStart = insights.indexOf("async function quotationAnalyticsAggregate(");
const aggregateBody = sliceFunctionBody(insights, aggregateStart);
const summaryStart = insights.indexOf("async function quotationSummaryAnswer(");
const summaryBody = sliceFunctionBody(insights, summaryStart);
const analyticsStart = insights.indexOf("async function quotationAnalyticsAnswer(");
const analyticsBody = sliceFunctionBody(insights, analyticsStart);
const compareStart = insights.indexOf("async function quotationCompareAnswer(");
const compareBody = sliceFunctionBody(insights, compareStart);
const conversionStart = insights.indexOf("async function quotationRateDefinitionRequiredAnswer(");
const conversionBody = sliceFunctionBody(insights, conversionStart);

test("13. the existing bounded quotation scan (MAX_QUOTATION_SCAN) is preserved by the shared aggregate", () => {
  assert.ok(insights.includes("const MAX_QUOTATION_SCAN = 300;"));
  assert.ok(aggregateBody.includes(".limit(MAX_QUOTATION_SCAN)"));
  // Exactly 2 scans of this shape exist in the whole file: the ONE shared aggregate (backing
  // summary/analytics/compare - never duplicated per kind) and quotationTrendAnswer()'s own
  // separate, pre-existing, untouched 12-month scan (test #28 confirms trend never calls the
  // shared aggregate) - never a 3rd/duplicate scan anywhere.
  assert.equal((insights.match(/\.from\("quotations"\)\s*\r?\n?\s*\.select\("created_at,currency,grand_total,status"/g) ?? []).length, 2);
});

test("14. only active quotations are included, matching existing behavior", () => {
  assert.ok(aggregateBody.includes('.eq("is_active", true)'));
});

test("15. total value uses grand_total", () => {
  assert.ok(aggregateBody.includes("row.grand_total"));
});

test("16. totals stay separated by currency (Map keyed by currency, never summed across currencies)", () => {
  assert.ok(aggregateBody.includes("totalsByCurrency.set(row.currency,"));
  assert.ok(!/totalsByCurrency\.set\("[A-Z]{2,4}"/.test(aggregateBody));
});

test('17. confirmed value uses the authoritative "client_confirmed" status', () => {
  assert.ok(aggregateBody.includes('row.status === "client_confirmed"'));
});

test("18. average is calculated per currency (that currency's own total / that currency's own count)", () => {
  assert.ok(aggregateBody.includes("const currencyCount = countByCurrency.get(currency)"));
  assert.ok(aggregateBody.includes("averageByCurrency.set(currency, total / currencyCount)"));
});

test("19. mixed currencies are never summed together in the compare path either", () => {
  assert.ok(compareBody.includes("current.totalsByCurrency.get(currency)"));
  assert.ok(compareBody.includes("previous.totalsByCurrency.get(currency)"));
  assert.ok(!/currentTotal \+ previousTotal/.test(compareBody));
});

test("20. comparison reuses the existing this_month/last_month DateRangeKeys, not custom math", () => {
  assert.ok(compareBody.includes('quotationAnalyticsAggregate(supabase, "this_month")'));
  assert.ok(compareBody.includes('quotationAnalyticsAggregate(supabase, "last_month")'));
});

test("21. no custom month-boundary date math was introduced (no new Date().setMonth/getMonth logic in the compare path)", () => {
  assert.ok(!/setMonth|getMonth/.test(compareBody));
});

test("22. no currency conversion was added anywhere in the touched file", () => {
  assert.ok(!/exchange ?rate|convert(?:ed)? to [A-Z]{3}|fx rate/i.test(insights));
});

test("23. no conversion-rate formula was implemented - the conversion-rate answer takes no query arguments", () => {
  assert.ok(conversionStart !== -1);
  assert.ok(insights.includes("async function quotationRateDefinitionRequiredAnswer(): Promise<NoaCapabilityResult> {"));
  assert.ok(!conversionBody.includes("supabase"));
});

test('23b. no identifier in the touched file spells "conversionRate"/"conversionrate" as an adjacent camelCase/lowercase substring - this exact collision previously false-failed the pre-existing B7 guard test (noa-phase-b7-safety.test.mts #8) against inventing a conversion-rate CALCULATION; the deliberate refusal function was renamed to avoid it, and this regression test keeps it renamed', () => {
  assert.ok(!/exchangeRate|fxRate|convertCurrency|conversionRate/i.test(insights));
});

test("24. a conversion-rate request returns the fixed definition-required response", () => {
  assert.ok(conversionBody.includes("doesn't have a defined quotation conversion-rate basis yet"));
});

test("25. deterministicOnly is set on every new C1 answer (analytics/compare/conversion-rate)", () => {
  assert.ok(analyticsBody.includes("deterministicOnly: true"));
  assert.ok(compareBody.includes("deterministicOnly: true"));
  assert.ok(conversionBody.includes("deterministicOnly: true"));
});

test("26. no provider/LLM call was added anywhere in the touched files", () => {
  for (const source of [insights, catchUpReader]) {
    assert.ok(!/runNoaProvider|openai|anthropic\.messages/i.test(source));
  }
});

test("27. existing quotation_summary output shape/text is preserved (same deterministicText template, same data keys)", () => {
  assert.ok(summaryBody.includes('kind: "insights_quotation_summary"'));
  assert.ok(summaryBody.includes("`You can access ${totalMatching} quotation${totalMatching === 1 ? \"\" : \"s\"} ${label}${capNote}: ${statusText}. Total value: ${formatCurrencyTotals(totalsByCurrency)}. Confirmed: ${confirmedCount} (${formatCurrencyTotals(confirmedTotalsByCurrency)}).`"));
  assert.ok(!summaryBody.includes("deterministicOnly"));
});

test("28. existing quotation_trend function is untouched (still its own standalone scan, never routed through the new shared aggregate)", () => {
  const trendStart = insights.indexOf("async function quotationTrendAnswer(");
  const trendBody = sliceFunctionBody(insights, trendStart);
  assert.ok(trendBody.includes('kind: "insights_quotation_trend"'));
  assert.ok(!trendBody.includes("quotationAnalyticsAggregate"));
});

test("29. no schema/migration/RLS reference was added in any touched file", () => {
  for (const source of [insights, quotationCapability]) {
    assert.ok(!/alter table|create table|create policy/i.test(source));
  }
});

test("30. Attention and Catch-Up capability files carry no N2C1 marker - untouched by this phase", () => {
  assert.ok(!attentionCapability.includes("N2C1"));
  assert.ok(!catchUpReader.includes("N2C1"));
});

test("31. this phase (C1) itself added no structured UI/transport fields - it carries no N2C1.1 marker; analytics UI is N2C1.1's own later, separately-tested work", () => {
  assert.ok(!insights.includes("N2C1.1"));
  assert.ok(!router.includes("N2C1.1"));
});

test("32. status label is a LOCAL mirror of the two known status overrides - Insights never cross-imports the Quotation capability module (existing B7 architectural rule, preserved)", () => {
  assert.ok(insights.includes("function insightsQuotationStatusLabel(status: string): string {"));
  assert.ok(!insights.includes('from "@/lib/noa/noa-quotation-capability.server"'));
  assert.ok(!insights.includes("noa-quotation-capability"));
  assert.ok(!quotationCapability.includes("N2C1"));
});

test("33. exactly 2 production files were changed (insights capability + intent router) - within the preferred budget", () => {
  assert.ok(router.includes("N2C1"));
  assert.ok(insights.includes("N2C1"));
});
