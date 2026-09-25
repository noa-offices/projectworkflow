// NOA 2.0C-2: Project File + Client analytics under the existing Insights domain, plus a bug fix
// (project_summary/client_summary's projectCount previously read the empty standalone `projects`
// table instead of ERP Project Files). Presentation/aggregation only - reuses the exact same
// projectFileFromLayoutSettings()/clientApprovalDraftFromLayoutSettings() parsing every other ERP
// Project File caller already uses, reimplemented locally (never importing another NOA capability
// module - existing B7 architectural rule, preserved). Source-level wiring/safety checks, same
// convention as every other *-safety.test.mts file in this codebase.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const insights = readFileSync("lib/noa/noa-insights-capability.server.ts", "utf8");
const router = readFileSync("lib/noa/noa-intent-router.ts", "utf8");
const types = readFileSync("lib/noa/noa-types.ts", "utf8");
const attentionCapability = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");
const catchUpReader = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");

function sliceFunctionBody(src: string, startIndex: number): string {
  const rest = src.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

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

const insightsProjectFilesStart = insights.indexOf("async function insightsProjectFiles(");
const insightsProjectFilesBody = sliceFunctionBody(insights, insightsProjectFilesStart);
const buildAggregateStart = insights.indexOf("function buildProjectFileAggregate(");
const buildAggregateBody = sliceFunctionBody(insights, buildAggregateStart);
const projectSummaryStart = insights.indexOf("async function projectSummaryAnswer(");
const projectSummaryBody = sliceFunctionBody(insights, projectSummaryStart);
const clientSummaryStart = insights.indexOf("async function clientSummaryAnswer(");
const clientSummaryBody = sliceFunctionBody(insights, clientSummaryStart);
const projectFileAnalyticsStart = insights.indexOf("async function projectFileAnalyticsAnswer(");
const projectFileAnalyticsBody = sliceFunctionBody(insights, projectFileAnalyticsStart);
const onHoldStart = insights.indexOf("async function projectFileOnHoldUnsupportedAnswer(");
const onHoldBody = sliceFunctionBody(insights, onHoldStart);
const clientQuotationAggStart = insights.indexOf("async function clientQuotationAggregate(");
const clientQuotationAggBody = sliceFunctionBody(insights, clientQuotationAggStart);
const clientRankingStart = insights.indexOf("async function clientRankingAnswer(");
const clientRankingBody = sliceFunctionBody(insights, clientRankingStart);
const rankByCurrencyStart = insights.indexOf("function rankClientsByCurrency(");
const rankByCurrencyBody = sliceFunctionBody(insights, rankByCurrencyStart);

// N2C2.0.1: extracts the REAL insightsQuestionKind() source (a pure, self-contained function -
// no closures over module state, no "@/..." aliases inside its own body) and evals it into a
// real callable function, so the precedence-fix tests below exercise actual behavior, not just
// text-order inference. `insights` is a trusted local file, never user input.
const classifierStart = insights.indexOf("function insightsQuestionKind(message: string): InsightsQuestionKind {");
const classifierSource = sliceFunctionBody(insights, classifierStart) + "\n}";
const classifierAsExpression = classifierSource.replace(
  "function insightsQuestionKind(message: string): InsightsQuestionKind {",
  "return function(message) {",
);
const insightsQuestionKind = new Function(classifierAsExpression)() as (message: string) => string;

test("1. No Analytics domain was added to NoaDomain", () => {
  assert.ok(types.includes('export type NoaDomain = "Product" | "Quotation" | "Price" | "Project" | "Client" | "Procurement" | "UserActivity" | "Admin" | "Insights" | "Attention" | "Help";'));
});

test("2. project_summary no longer queries the standalone `projects` table", () => {
  assert.ok(!projectSummaryBody.includes('.from("projects")'));
  assert.ok(projectSummaryBody.includes("insightsProjectFiles(supabase)"));
});

test("3. client_summary's projectCount no longer queries the standalone `projects` table", () => {
  assert.ok(!clientSummaryBody.includes('.from("projects")'));
  assert.ok(clientSummaryBody.includes("insightsProjectFiles(supabase)"));
});

test("4. Project File data comes from insightsProjectFiles(), which reimplements the SAME parsing allProjectFiles() uses - never a re-derived rule", () => {
  assert.ok(insightsProjectFilesBody.includes("projectFileFromLayoutSettings(quotation.layout_settings)"));
  assert.ok(insightsProjectFilesBody.includes("clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder"));
});

test("5/6/7. active/completed/cancelled status uses the exact proven 3-value rule (cancelledAt -> completedAt -> active), never a 4th state", () => {
  assert.ok(insightsProjectFilesBody.includes("cancelledAt ? \"cancelled\" : completedAt ? \"completed\" : \"active\""));
});

test("8. no on_hold Project File metric was invented anywhere in the aggregate/analytics code", () => {
  assert.ok(!buildAggregateBody.includes("onHold"));
  assert.ok(!projectFileAnalyticsBody.includes("onHold"));
  assert.ok(!/on_hold|onHoldCount|pendingCount|delayedCount/.test(insights.slice(insightsProjectFilesStart, projectFileAnalyticsStart + 2000)));
});

test("9. Project File value uses the owning quotation's already-established total/currency (order.total/order.currency), never procurement/invoice/payment totals", () => {
  assert.ok(insightsProjectFilesBody.includes("total: order.total,"));
  assert.ok(insightsProjectFilesBody.includes("currency: order.currency,"));
  assert.ok(!buildAggregateBody.includes("procurement") && !buildAggregateBody.includes("invoice") && !buildAggregateBody.includes("payment"));
});

test("10. Project File value remains separated by currency (Map keyed by currency, never summed across currencies)", () => {
  assert.ok(buildAggregateBody.includes("totalsByCurrency.set(order.currency,"));
  assert.ok(buildAggregateBody.includes("activeTotalsByCurrency.set(order.currency,"));
});

test("11. client quotation count is computed per client from the bounded quotation aggregate", () => {
  assert.ok(clientQuotationAggBody.includes("entry.count += 1;"));
  assert.ok(clientRankingBody.includes("quotationAggregate.byClient.get(clientId)!.count"));
});

test("12. client quotation value uses quotations.grand_total, never a recomputed item total", () => {
  assert.ok(clientQuotationAggBody.includes("row.grand_total"));
  assert.ok(clientQuotationAggBody.includes('.select("client_id,currency,grand_total,status"'));
});

test('13. confirmed client value uses the exact authoritative "client_confirmed" condition', () => {
  assert.ok(clientQuotationAggBody.includes('row.status === "client_confirmed"'));
});

test("14. Project File value by client uses ERP Project Files (buildProjectFileAggregate's byClient), never the standalone `projects` table", () => {
  assert.ok(clientRankingBody.includes("projectAggregate.byClient.entries()"));
  assert.ok(!clientRankingBody.includes('.from("projects")'));
});

test("15. top clients use a deterministic numeric sort (descending), never a fuzzy/semantic ranking", () => {
  assert.ok(rankByCurrencyBody.includes("rows.sort((a, b) => b.value - a.value)"));
  assert.ok(clientRankingBody.includes(".sort((a, b) => b.count - a.count)"));
});

test("16. multi-currency client ranking never combines currencies into one figure", () => {
  assert.ok(rankByCurrencyBody.includes("byCurrency.get(currency)"));
  assert.ok(!/value \+= |totalValue \+=/.test(rankByCurrencyBody));
});

test('17. "project file analytics" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "project file analytics"));
});

test('18. "project analytics" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "project analytics"));
});

test('19. "client analytics" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "client analytics"));
});

test('20. "top clients by quotation value" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "top clients by quotation value"));
});

test('21. "top clients by confirmed value" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "top clients by confirmed value"));
});

test('22. "top clients by project value" matches an INSIGHTS_PATTERNS entry', () => {
  assert.ok(matchesAny(insightsPatterns, "top clients by project value"));
});

test('23. "tell me about CO-0003-001" and "tell me about Apex Luxury Retail" never match the new INSIGHTS_PATTERNS entries (stay on their existing Project/Client routes)', () => {
  for (const message of ["tell me about co-0003-001", "tell me about apex luxury retail"]) {
    assert.ok(!matchesAny(insightsPatterns, message), `unexpectedly matched: ${message}`);
  }
});

test('24. "what changed on CO-0003-001" still matches CATCH_UP_PATTERNS (checked at a higher routing precedence than Insights, unmodified by this phase)', () => {
  assert.ok(matchesAny(catchUpPatterns, "what changed on co-0003-001"));
});

test('25. "what needs my attention" still matches ATTENTION_PATTERNS (checked at a higher routing precedence than Insights, unmodified by this phase)', () => {
  assert.ok(matchesAny(attentionPatterns, "what needs my attention"));
});

test("26. Project File scan stays bounded (PROJECT_FILE_SCAN_LIMIT), never an unbounded read", () => {
  assert.ok(insights.includes("const PROJECT_FILE_SCAN_LIMIT = 200;"));
  assert.ok(insightsProjectFilesBody.includes(".limit(PROJECT_FILE_SCAN_LIMIT)"));
});

test("27. client quotation scan stays bounded (reuses MAX_QUOTATION_SCAN), never an unbounded read", () => {
  assert.ok(clientQuotationAggBody.includes(".limit(MAX_QUOTATION_SCAN)"));
});

// ── N2C2.0.1: intent-precedence fix ─────────────────────────────────────────────────────────────
// Live UAT proved the classifier's generic quotation_summary check ("/\bquotations?\b/") won
// before the more specific client_ranking check for any client-ranking phrase that happens to
// contain the literal word "quotation(s)" - "top clients by quotation value" and "how many
// quotations does each client have" were misrouted to the current-month quotation summary
// instead of the all-time client ranking. Fixed by moving the client_ranking check earlier in the
// classifier (see lib/noa/noa-insights-capability.server.ts). These tests call the REAL extracted
// classifier function, not a re-derived guess.

test("C2.0.1-1. \"top clients by quotation value\" resolves to client_ranking, not quotation_summary", () => {
  assert.equal(insightsQuestionKind("top clients by quotation value"), "client_ranking");
});

test("C2.0.1-2. \"top clients by confirmed value\" resolves to client_ranking", () => {
  assert.equal(insightsQuestionKind("top clients by confirmed value"), "client_ranking");
});

test("C2.0.1-3. \"top clients by project value\" resolves to client_ranking", () => {
  assert.equal(insightsQuestionKind("top clients by project value"), "client_ranking");
});

test("C2.0.1-4. \"how many quotations does each client have\" resolves to client_ranking, not quotation_summary", () => {
  assert.equal(insightsQuestionKind("how many quotations does each client have"), "client_ranking");
});

test("C2.0.1-5. \"client analytics\" resolves to client_ranking", () => {
  assert.equal(insightsQuestionKind("client analytics"), "client_ranking");
});

test("C2.0.1-6. none of the 5 client-ranking phrases fall through to any date-scoped kind - the classifier itself never resolves a period for them (period defaulting, if any, happens only inside clientRankingAnswer(), which takes no date-range argument)", () => {
  for (const message of [
    "top clients by quotation value",
    "top clients by confirmed value",
    "top clients by project value",
    "how many quotations does each client have",
    "client analytics",
  ]) {
    assert.equal(insightsQuestionKind(message), "client_ranking");
  }
  assert.ok(!clientRankingBody.includes("insightsDateRangeKey"));
  assert.ok(!clientRankingBody.includes("resolveDateRange"));
});

test("C2.0.1-7. \"quotation analytics\" still resolves to quotation_analytics (C1), unaffected by the client-ranking reordering", () => {
  assert.equal(insightsQuestionKind("quotation analytics"), "quotation_analytics");
});

test("C2.0.1-8. \"how much did we quote this month\" still resolves to quotation_summary (C1)", () => {
  assert.equal(insightsQuestionKind("how much did we quote this month"), "quotation_summary");
});

test("C2.0.1-9. \"how many quotations this month\" still resolves to quotation_summary (C1)", () => {
  assert.equal(insightsQuestionKind("how many quotations this month"), "quotation_summary");
});

test("C2.0.1-10. \"quotation status breakdown\" still resolves to quotation_analytics (C1)", () => {
  assert.equal(insightsQuestionKind("quotation status breakdown"), "quotation_analytics");
});

test("C2.0.1-11. Project File analytics phrasing is unaffected by the reordering", () => {
  assert.equal(insightsQuestionKind("project file analytics"), "project_file_analytics");
  assert.equal(insightsQuestionKind("how many active project files"), "project_file_analytics");
});

test("C2.0.1-12. currency-safe client ranking code itself is unchanged by this fix (no calculation edit)", () => {
  assert.ok(!clientRankingBody.includes("N2C2.0.1"));
  assert.ok(!buildAggregateBody.includes("N2C2.0.1"));
  assert.ok(!rankByCurrencyBody.includes("N2C2.0.1"));
});

test("C2.0.1-13. no new query was added - clientQuotationAggregate/insightsProjectFiles carry no N2C2.0.1 marker", () => {
  assert.ok(!clientQuotationAggBody.includes("N2C2.0.1"));
  assert.ok(!insightsProjectFilesBody.includes("N2C2.0.1"));
});

test("C2.0.1-14. no UI/transport file was touched by this fix", () => {
  const messages = readFileSync("components/noa/noa-messages.tsx", "utf8");
  const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
  assert.ok(!messages.includes("N2C2.0.1"));
  assert.ok(!orchestrator.includes("N2C2.0.1"));
});

test("C2.0.1-15. no schema/RLS/auth change - no auth helper call was added inside the classifier region", () => {
  const classifierRegion = insights.slice(classifierStart, classifierStart + classifierSource.length);
  assert.ok(!/require[A-Z]\w*\(\)/.test(classifierRegion));
});

test("28. no provider/LLM call was added anywhere in the touched files", () => {
  for (const source of [insights, router]) {
    assert.ok(!/runNoaProvider|openai|anthropic\.messages/i.test(source));
  }
});

test("29. deterministicOnly is set on every new C2 answer (project file analytics/on-hold refusal/client ranking)", () => {
  assert.ok(projectFileAnalyticsBody.includes("deterministicOnly: true"));
  assert.ok(onHoldBody.includes("deterministicOnly: true"));
  assert.ok(clientRankingBody.includes("deterministicOnly: true"));
});

test("30. no schema/migration/RLS reference was added in either touched file", () => {
  for (const source of [insights, router]) {
    assert.ok(!/alter table|create table|create policy/i.test(source));
  }
});

test("31. no ownership/creator/assigned-user filter was added - every new query is scoped only by requireActiveUser(), no .eq(\"created_by\"...)/.eq(\"assigned_to\"...) style filter", () => {
  const c2Region = insights.slice(insightsProjectFilesStart, insights.length);
  assert.ok(!/created_by|assigned_to|owner_id|salesperson/i.test(c2Region));
});

test("32. C1 quotation analytics is unchanged - quotationAnalyticsAggregate/quotationCompareAnswer/quotationTrendAnswer carry no N2C2 marker", () => {
  const aggStart = insights.indexOf("async function quotationAnalyticsAggregate(");
  const aggBody = sliceFunctionBody(insights, aggStart);
  assert.ok(!aggBody.includes("N2C2"));
  const trendStart = insights.indexOf("async function quotationTrendAnswer(");
  const trendBody = sliceFunctionBody(insights, trendStart);
  assert.ok(!trendBody.includes("N2C2"));
});

test("33. Attention capability is untouched by this phase", () => {
  assert.ok(!attentionCapability.includes("N2C2"));
});

test("34. Catch-Up reader is untouched by this phase", () => {
  assert.ok(!catchUpReader.includes("N2C2"));
});
