// NOA 2.0C-1.1: Quotation Analytics structured UI (metric cards/status breakdown/comparison/
// trend) + a small Catch-Up change-row spacing polish. Presentation/transport only - no
// calculation, date-range, routing, permission, or schema change. Source-level wiring/safety
// checks, same convention as every other *-safety.test.mts / noa-*.test.mts file in this codebase
// (server-only "@/..." aliases and "use client" components are not resolvable by Node's plain ESM
// resolver outside the Next.js build).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const messages = readFileSync("components/noa/noa-messages.tsx", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const types = readFileSync("lib/noa/noa-types.ts", "utf8");
const assistant = readFileSync("components/noa/noa-assistant.tsx", "utf8");
const insights = readFileSync("lib/noa/noa-insights-capability.server.ts", "utf8");
const attentionCapability = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");

function sliceFunctionBody(src: string, startIndex: number): string {
  const rest = src.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

test("1. client never parses analytics prose - the transport is built from structured capabilityResult.data, never message.text/deterministicText", () => {
  const buildStart = orchestrator.indexOf("function buildQuotationAnalyticsTransport(");
  const buildBody = sliceFunctionBody(orchestrator, buildStart);
  assert.ok(!/deterministicText\.match|deterministicText\.split|deterministicText\.replace/.test(buildBody));
  const cardsStart = messages.indexOf("function NoaAnalyticsCards(");
  const cardsBody = sliceFunctionBody(messages, cardsStart);
  assert.ok(!cardsBody.includes("message.text"));
});

test("2. structured Analytics payload comes from the server - orchestrator guards check the real capabilityResult.data kind", () => {
  assert.ok(orchestrator.includes('(data as { kind?: unknown }).kind === "insights_quotation_analytics"'));
  assert.ok(orchestrator.includes('candidate.kind === "insights_quotation_compare"'));
  assert.ok(orchestrator.includes('(data as { kind?: unknown }).kind === "insights_quotation_trend"'));
});

test("3. no DB/internal UUID is ever included in the analytics transport type or its builder functions", () => {
  const typeStart = types.indexOf("export type NoaAnalyticsTransport");
  const typeRegion = types.slice(types.indexOf("export type NoaAnalyticsMetric"), typeStart + 400);
  assert.ok(!/\bid\b|uuid/i.test(typeRegion));
  const orchestratorAnalyticsRegion = orchestrator.slice(orchestrator.indexOf("type NoaQuotationAnalyticsData"), orchestrator.indexOf("function buildAnalyticsTransport("));
  assert.ok(!/quotation_id|entity_id|created_by/i.test(orchestratorAnalyticsRegion));
});

test("3b. C1.2: title and period have distinct visual weight (bold title vs muted period), rendered as separate lines, not merged into one string", () => {
  const cardsStart = messages.indexOf("function NoaAnalyticsCards(");
  const cardsBody = sliceFunctionBody(messages, cardsStart);
  assert.ok(cardsBody.includes('<div className="text-sm font-bold text-zinc-900">{analytics.title}</div>'));
  assert.ok(cardsBody.includes('{analytics.period ? <div className="text-xs text-zinc-500">{analytics.period}</div> : null}'));
  assert.ok(!cardsBody.includes("${analytics.title} — ${analytics.period}"));
});

test("3c. C1.2: card/tile spacing was tightened versus C1.1 (compact padding/gaps), never removed entirely", () => {
  const cardsStart = messages.indexOf("function NoaAnalyticsCards(");
  const cardsBody = sliceFunctionBody(messages, cardsStart);
  assert.ok(cardsBody.includes('gap-2.5 rounded-2xl border border-zinc-200 bg-zinc-50 p-2.5'));
  const metricCardStart = messages.indexOf("function NoaAnalyticsMetricCard(");
  const metricCardBody = sliceFunctionBody(messages, metricCardStart);
  assert.ok(metricCardBody.includes('border border-zinc-200 bg-white p-2"'));
});

test("4. quotation metric cards render via NoaAnalyticsMetricCard, mapped from analytics.metrics", () => {
  assert.ok(messages.includes("function NoaAnalyticsMetricCard("));
  const cardsStart = messages.indexOf("function NoaAnalyticsCards(");
  const cardsBody = sliceFunctionBody(messages, cardsStart);
  assert.ok(cardsBody.includes("analytics.metrics.map((metric) =>"));
});

test("5. period renders from analytics.period, never recomputed/inferred client-side", () => {
  const cardsStart = messages.indexOf("function NoaAnalyticsCards(");
  const cardsBody = sliceFunctionBody(messages, cardsStart);
  assert.ok(cardsBody.includes("{analytics.period ? <div"));
});

test("6. quotation count metric is built from data.totalMatching", () => {
  const buildStart = orchestrator.indexOf("function buildQuotationAnalyticsTransport(");
  const buildBody = sliceFunctionBody(orchestrator, buildStart);
  assert.ok(buildBody.includes('{ key: "count", label: "Quotations", value: String(data.totalMatching) }'));
});

test("7. quoted value metric is built from data.totalsByCurrency via analyticsCurrencyLines (never re-summed)", () => {
  const buildStart = orchestrator.indexOf("function buildQuotationAnalyticsTransport(");
  const buildBody = sliceFunctionBody(orchestrator, buildStart);
  assert.ok(buildBody.includes('label: "Quoted value", value: analyticsCurrencyLines(data.totalsByCurrency)'));
});

test("8. average value metric is built from data.averageByCurrency, the SAME server-computed average (no client division)", () => {
  const buildStart = orchestrator.indexOf("function buildQuotationAnalyticsTransport(");
  const buildBody = sliceFunctionBody(orchestrator, buildStart);
  assert.ok(buildBody.includes('label: "Average value", value: analyticsCurrencyLines(data.averageByCurrency)'));
  assert.ok(!/averageByCurrency.*\/\s*count/i.test(orchestrator));
});

test("9. confirmed value metric uses an honest dash when confirmedCount is 0, never a fabricated currency zero", () => {
  const buildStart = orchestrator.indexOf("function buildQuotationAnalyticsTransport(");
  const buildBody = sliceFunctionBody(orchestrator, buildStart);
  assert.ok(buildBody.includes('(data.confirmedCount ?? 0) > 0 ? analyticsCurrencyLines(data.confirmedTotalsByCurrency) : "—"'));
});

test('9b. C1.2: the "—" empty-confirmed value renders visually lighter (muted/normal weight) than a real metric value (bold) - a pure style branch on the already-server-decided string, never a data reinterpretation', () => {
  const cardStart = messages.indexOf("function NoaAnalyticsMetricCard(");
  const cardBody = sliceFunctionBody(messages, cardStart);
  assert.ok(cardBody.includes('const isEmptyValue = metric.value === "—";'));
  assert.ok(cardBody.includes('"text-sm font-normal text-zinc-400"'));
  assert.ok(cardBody.includes('"text-base font-bold text-zinc-900"'));
});

test('9c. C1.2: a real numeric value (including a genuine "0") is never routed through the empty-dash style branch - the check is an exact string match against the dash character only, never a falsy/zero check', () => {
  const cardStart = messages.indexOf("function NoaAnalyticsMetricCard(");
  const cardBody = sliceFunctionBody(messages, cardStart);
  assert.ok(!/metric\.value\s*===\s*["'`]0["'`]/.test(cardBody));
  assert.ok(!/!metric\.value/.test(cardBody));
});

test("10. multi-currency values stay separated - analyticsCurrencyLines joins per-currency entries with newlines, never sums them", () => {
  const fnStart = orchestrator.indexOf("function analyticsCurrencyLines(");
  const fnBody = sliceFunctionBody(orchestrator, fnStart);
  assert.ok(fnBody.includes('.join("\\n")'));
  assert.ok(!/total \+=|reduce\(\(sum/.test(fnBody));
  const cardStart = messages.indexOf("function NoaAnalyticsMetricCard(");
  const cardBody = sliceFunctionBody(messages, cardStart);
  assert.ok(cardBody.includes("whitespace-pre-line"));
});

test("11. status breakdown renders as chips mapped from analytics.statusBreakdown", () => {
  assert.ok(messages.includes("function NoaAnalyticsStatusChip("));
  const buildStart = orchestrator.indexOf("function buildQuotationAnalyticsTransport(");
  const buildBody = sliceFunctionBody(orchestrator, buildStart);
  assert.ok(buildBody.includes("Object.entries(data.statusCounts ?? {}).map(([status, count]) => ({ label: analyticsStatusLabel(status), count }))"));
});

test("12. comparison renders current vs previous via NoaAnalyticsComparisonBlock, reading currentCount/previousCount/currencyRows", () => {
  assert.ok(messages.includes("function NoaAnalyticsComparisonBlock("));
  const blockStart = messages.indexOf("function NoaAnalyticsComparisonBlock(");
  const blockBody = sliceFunctionBody(messages, blockStart);
  assert.ok(blockBody.includes("comparison.currentCount"));
  assert.ok(blockBody.includes("comparison.previousCount"));
  assert.ok(blockBody.includes("comparison.currencyRows.map("));
});

test("13. comparison difference renders factually under its own \"Difference\" header, no evaluative language (C1.2: restructured from an inline \"Difference: ...\" prefix into a dedicated section, same underlying countDiffText/currencyRows values)", () => {
  const blockStart = messages.indexOf("function NoaAnalyticsComparisonBlock(");
  const blockBody = sliceFunctionBody(messages, blockStart);
  assert.ok(blockBody.includes(">Difference<"));
  assert.ok(blockBody.includes("`${countDiffText} quotation"));
  assert.ok(!/better|worse|improvement|declin(ed|ing)|good|bad|healthy|unhealthy/i.test(blockBody));
});

test("14. trend renders month rows via NoaAnalyticsTrendRowView, mapped from analytics.trend", () => {
  assert.ok(messages.includes("function NoaAnalyticsTrendRowView("));
  const cardsStart = messages.indexOf("function NoaAnalyticsCards(");
  const cardsBody = sliceFunctionBody(messages, cardsStart);
  assert.ok(cardsBody.includes("analytics.trend.map((row) =>"));
});

test("15. no chart library was introduced - no SVG, no canvas, no chart package import", () => {
  for (const source of [messages, orchestrator, types]) {
    assert.ok(!/<svg|<canvas|from ["']recharts["']|from ["']chart\.js["']|from ["']d3["']/i.test(source));
  }
});

test("16. empty state renders cleanly via analytics.emptyMessage, never empty metric boxes full of zeros", () => {
  const cardsStart = messages.indexOf("function NoaAnalyticsCards(");
  const cardsBody = sliceFunctionBody(messages, cardsStart);
  assert.ok(cardsBody.includes("{analytics.emptyMessage ? ("));
  const analyticsBuildStart = orchestrator.indexOf("function buildQuotationAnalyticsTransport(");
  const analyticsBuildBody = sliceFunctionBody(orchestrator, analyticsBuildStart);
  assert.ok(analyticsBuildBody.includes("if (!data.totalsByCurrency) {"));
  assert.ok(analyticsBuildBody.includes("emptyMessage: data.deterministicText"));
});

test("17. the conversion-rate answer is never turned into an analytics payload - stays plain prose", () => {
  const dispatchStart = orchestrator.indexOf("function buildAnalyticsTransport(");
  const dispatchBody = sliceFunctionBody(orchestrator, dispatchStart);
  assert.ok(!dispatchBody.includes("conversion_rate"));
  assert.ok(!orchestrator.includes("insights_quotation_conversion_rate"));
});

test("18. structured Analytics suppresses the duplicated long prose bubble - mutually exclusive branches, same pattern as Attention/Catch-Up", () => {
  assert.ok(messages.includes("hasAnalyticsCards && message.analytics ? ("));
  const ternaryStart = messages.indexOf("{hasAttentionCards && message.attention ? (");
  const ternaryBody = messages.slice(ternaryStart, ternaryStart + 1000);
  assert.ok(ternaryBody.includes("hasAnalyticsCards && message.analytics"));
  assert.ok(ternaryBody.includes("{message.text}"));
});

test("19. fallback prose works without an analytics payload - hasAnalyticsCards is gated on Boolean(message.analytics)", () => {
  assert.ok(messages.includes("Boolean(message.analytics)"));
});

test("20. Attention rendering is unchanged - same NoaAttentionCards component, still checked first in priority order", () => {
  const ternaryStart = messages.indexOf("{hasAttentionCards && message.attention ? (");
  const ternaryBody = messages.slice(ternaryStart, ternaryStart + 200).replace(/\r\n/g, "\n");
  assert.ok(ternaryBody.startsWith("{hasAttentionCards && message.attention ? (\n              <NoaAttentionCards attention={message.attention} />"));
  assert.ok(!attentionCapability.includes("N2C1.1"));
});

test("21. Catch-Up rendering is unchanged except the spacing polish - same NoaCatchUpTimeline/NoaCatchUpEventRow structure, no grouping/business-logic change", () => {
  assert.ok(messages.includes("function NoaCatchUpTimeline("));
  assert.ok(messages.includes("function NoaCatchUpEventRow("));
  const catchUpReader = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
  assert.ok(!catchUpReader.includes("N2C1.1"));
});

test("22. Catch-Up arrow has visible, explicit spacing baked into the text content (not solely reliant on CSS flex-gap)", () => {
  const rowStart = messages.indexOf("function NoaCatchUpChangeRow(");
  const rowBody = sliceFunctionBody(messages, rowStart);
  assert.ok(rowBody.includes("`${formattedOld} → ${formattedNew}`"));
});

test("23. Catch-Up Added/Cleared use a visible middle-dot separator baked into the text content", () => {
  const rowStart = messages.indexOf("function NoaCatchUpChangeRow(");
  const rowBody = sliceFunctionBody(messages, rowStart);
  assert.ok(rowBody.includes("`· ${formattedNew}`"));
  assert.ok(rowBody.includes("`· was ${formattedOld}`"));
});

test("24. ordinary (non-Analytics, non-Catch-Up, non-Attention) messages are unchanged - the plain <p> bubble is still the final else branch, and still the only <p> tag", () => {
  assert.equal((messages.match(/<p\b/g) ?? []).length, 1);
});

test("25. no clickable metric cards/status chips - plain div/span only, never <button> or onClick", () => {
  for (const fnName of ["NoaAnalyticsMetricCard", "NoaAnalyticsStatusChip", "NoaAnalyticsComparisonBlock", "NoaAnalyticsTrendRowView"]) {
    const start = messages.indexOf(`function ${fnName}(`);
    const body = sliceFunctionBody(messages, start);
    assert.ok(!body.includes("<button"), `${fnName} must not render a button`);
    assert.ok(!body.includes("onClick"), `${fnName} must not have an onClick handler`);
  }
});

test("26. no table/horizontal-scroll dependency in the new Analytics UI code", () => {
  const cardsStart = messages.indexOf("function NoaAnalyticsMetricCard(");
  const cardsRegion = messages.slice(cardsStart, messages.indexOf("function NoaAnalyticsCards(") + 2000);
  assert.ok(!/<table|overflow-x-auto|overflow-x-scroll/i.test(cardsRegion));
});

test("27. routing is unchanged - noa-intent-router.ts carries no N2C1.1 marker", () => {
  const router = readFileSync("lib/noa/noa-intent-router.ts", "utf8");
  assert.ok(!router.includes("N2C1.1"));
});

test("28. quotation calculations are unchanged - noa-insights-capability.server.ts carries no N2C1.1 marker (this phase never edited it)", () => {
  assert.ok(!insights.includes("N2C1.1"));
});

test("29. auth is unchanged - no auth helper import/call was added in any touched file", () => {
  for (const source of [orchestrator, assistant, messages]) {
    assert.ok(!/requireActiveUser|requireProcurementManager|requireProductLibraryManager|requireSystemOwner/.test(source) || source === orchestrator);
  }
  // orchestrator itself gets a pass on containing auth helper NAMES elsewhere in the file (it
  // already imports/re-exports plenty), but must not have added a NEW auth call inside the
  // analytics transport builder region specifically.
  const region = orchestrator.slice(orchestrator.indexOf("type NoaQuotationAnalyticsData"), orchestrator.indexOf("function buildAnalyticsTransport(") + 300);
  assert.ok(!/require[A-Z]\w*\(\)/.test(region));
});

test("30. no schema/migration/RLS reference was added in any touched file", () => {
  for (const source of [types, orchestrator, assistant, messages]) {
    assert.ok(!/alter table|create table|create policy/i.test(source));
  }
});
