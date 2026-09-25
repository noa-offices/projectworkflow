// NOA 2.0C-2.1: structured Project File + Client analytics UI over the EXISTING C1 analytics
// transport/card UI. Presentation/transport only - the C2 Insights calculations are untouched.
// The orchestrator's analytics builder region is extracted from source, type-stripped with the
// repo's own TypeScript compiler, and executed for real (the orchestrator itself imports
// server-only modules, so it can't be imported under plain Node) - same "extract the real
// function" convention as noa-phase-n2c2-safety.test.mts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const messages = readFileSync("components/noa/noa-messages.tsx", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const types = readFileSync("lib/noa/noa-types.ts", "utf8");
const insights = readFileSync("lib/noa/noa-insights-capability.server.ts", "utf8");
const attentionCapability = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");
const catchUpReader = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");

function sliceFunctionBody(src: string, startIndex: number): string {
  const rest = src.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

type Transport = {
  kind: string;
  title: string;
  period?: string;
  metrics?: Array<{ key: string; label: string; value: string }>;
  statusBreakdown?: Array<{ label: string; count: number }>;
  rankings?: Array<{ heading?: string; rows: Array<{ rank: number; label: string; value: string }> }>;
  note?: string;
  emptyMessage?: string;
};

const regionStart = orchestrator.indexOf("type NoaQuotationAnalyticsData");
const dispatchStart = orchestrator.indexOf("function buildAnalyticsTransport(");
const regionSource = orchestrator.slice(regionStart, dispatchStart) + sliceFunctionBody(orchestrator, dispatchStart) + "\n}\n";
const regionJs = ts.transpileModule(regionSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const buildAnalyticsTransport = new Function(`${regionJs}\nreturn buildAnalyticsTransport;`)() as (domain: string, data: unknown) => Transport | undefined;

const projectFileData = {
  activeCount: 3,
  activeTotalsByCurrency: { AED: 150000, USD: 20000 },
  cancelledCount: 1,
  cancelledTotalsByCurrency: { AED: 5000 },
  completedCount: 2,
  completedTotalsByCurrency: { AED: 80000 },
  kind: "insights_project_file_analytics",
  totalCount: 6,
  deterministicOnly: true,
  deterministicText: "Project File analytics\n\n6 Project Files",
};

test("1. Project File analytics produces a project_file_analytics transport from structured data", () => {
  const transport = buildAnalyticsTransport("Insights", projectFileData);
  assert.equal(transport?.kind, "project_file_analytics");
  assert.equal(transport?.title, "Project File analytics");
});

test("2. Project File metrics: count, Active value, Completed value", () => {
  const transport = buildAnalyticsTransport("Insights", projectFileData)!;
  const byKey = Object.fromEntries((transport.metrics ?? []).map((metric) => [metric.key, metric]));
  assert.equal(byKey.project_files.value, "6");
  assert.equal(byKey.active_value.label, "Active value");
  assert.equal(byKey.completed_value.label, "Completed value");
  assert.equal(byKey.completed_value.value, "AED 80,000");
});

test("3. Project File status breakdown is exactly Active/Completed/Cancelled with the server's counts (never an on-hold state)", () => {
  const transport = buildAnalyticsTransport("Insights", projectFileData)!;
  assert.deepEqual(transport.statusBreakdown, [
    { count: 3, label: "Active" },
    { count: 2, label: "Completed" },
    { count: 1, label: "Cancelled" },
  ]);
  assert.ok(!JSON.stringify(transport).toLowerCase().includes("hold"));
});

test("4. Project File values stay currency-separated - one line per currency, never summed", () => {
  const transport = buildAnalyticsTransport("Insights", projectFileData)!;
  const active = transport.metrics!.find((metric) => metric.key === "active_value")!;
  assert.equal(active.value, "AED 150,000\nUSD 20,000");
  assert.ok(!active.value.includes("170,000"));
});

test("5. Project File empty state reuses the server's own empty sentence, never zero tiles", () => {
  const transport = buildAnalyticsTransport("Insights", { kind: "insights_project_file_analytics", totalCount: 0, deterministicOnly: true, deterministicText: "I found no ERP Project Files." })!;
  assert.equal(transport.emptyMessage, "I found no ERP Project Files.");
  assert.equal(transport.metrics, undefined);
  assert.equal(transport.statusBreakdown, undefined);
});

const valueRankingData = (metric: string) => ({
  kind: "insights_client_ranking",
  metric,
  rankings: [
    { currency: "AED", rows: [{ clientName: "Apex Luxury Retail", value: 250000 }, { clientName: "Blue Tower LLC", value: 90000.5 }] },
    { currency: "USD", rows: [{ clientName: "Gulf Hotels", value: 40000 }] },
  ],
  deterministicOnly: true,
  deterministicText: "Top clients",
});

test("6. client quotation-value ranking: one numbered group per currency", () => {
  const transport = buildAnalyticsTransport("Insights", valueRankingData("quotation_value"))!;
  assert.equal(transport.kind, "client_analytics");
  assert.equal(transport.title, "Top clients by quotation value");
  assert.deepEqual(transport.rankings, [
    { heading: "AED", rows: [{ label: "Apex Luxury Retail", rank: 1, value: "AED 250,000" }, { label: "Blue Tower LLC", rank: 2, value: "AED 90,000.5" }] },
    { heading: "USD", rows: [{ label: "Gulf Hotels", rank: 1, value: "USD 40,000" }] },
  ]);
});

test("7. client confirmed-value ranking uses its own title and per-currency groups", () => {
  const transport = buildAnalyticsTransport("Insights", valueRankingData("confirmed_value"))!;
  assert.equal(transport.title, "Top clients by confirmed value");
  assert.equal(transport.rankings?.length, 2);
});

test("8. client Project File-value ranking uses its own title and per-currency groups", () => {
  const transport = buildAnalyticsTransport("Insights", valueRankingData("project_value"))!;
  assert.equal(transport.title, "Top clients by project value");
  assert.deepEqual(transport.rankings?.map((group) => group.heading), ["AED", "USD"]);
});

test("9. no cross-currency merging and no fake overall top client - every currency keeps its own rank 1", () => {
  const transport = buildAnalyticsTransport("Insights", valueRankingData("quotation_value"))!;
  const firsts = transport.rankings!.map((group) => group.rows[0].rank);
  assert.deepEqual(firsts, [1, 1]);
  assert.ok(!JSON.stringify(transport).includes("290,000"));
  const builderBody = sliceFunctionBody(orchestrator, orchestrator.indexOf("function buildClientRankingTransport("));
  assert.ok(!/reduce\(|\+= /.test(builderBody));
});

test("10. quotation-count ranking is a single currency-free group with plain counts", () => {
  const transport = buildAnalyticsTransport("Insights", {
    kind: "insights_client_ranking",
    metric: "quotation_count",
    rows: [{ clientName: "Apex Luxury Retail", count: 12 }, { clientName: "Blue Tower LLC", count: 4 }],
    deterministicOnly: true,
    deterministicText: "Quotations per client",
  })!;
  assert.equal(transport.title, "Quotations per client");
  assert.deepEqual(transport.rankings, [{ rows: [{ label: "Apex Luxury Retail", rank: 1, value: "12" }, { label: "Blue Tower LLC", rank: 2, value: "4" }] }]);
  assert.ok(!/AED|USD/.test(JSON.stringify(transport)));
});

test("11. client ranking empty states reuse the server's empty sentence", () => {
  const countEmpty = buildAnalyticsTransport("Insights", { kind: "insights_client_ranking", metric: "quotation_count", rows: [], deterministicText: "I found no recorded quotations to count by client." })!;
  assert.equal(countEmpty.emptyMessage, "I found no recorded quotations to count by client.");
  const valueEmpty = buildAnalyticsTransport("Insights", { kind: "insights_client_ranking", metric: "project_value", rankings: [], deterministicText: "I found no recorded Project File value to rank clients by." })!;
  assert.equal(valueEmpty.emptyMessage, "I found no recorded Project File value to rank clients by.");
  assert.equal(valueEmpty.rankings, undefined);
});

test("12. client summary renders as compact metric cards (active/archived/Project Files)", () => {
  const transport = buildAnalyticsTransport("Insights", { activeClients: 40, archivedClients: 3, kind: "insights_client_summary", projectCount: 18, deterministicText: "There are 40 active clients" })!;
  assert.equal(transport.title, "Client summary");
  assert.deepEqual(transport.metrics?.map((metric) => [metric.label, metric.value]), [["Active clients", "40"], ["Archived clients", "3"], ["Project Files", "18"]]);
});

test("13. client summary is deterministicOnly so the card is never paired with provider re-narration", () => {
  const body = sliceFunctionBody(insights, insights.indexOf("async function clientSummaryAnswer("));
  assert.ok(body.includes("deterministicOnly: true"));
});

test("14. non-Insights domains and unrelated Insights kinds never get an analytics payload", () => {
  assert.equal(buildAnalyticsTransport("Project", projectFileData), undefined);
  assert.equal(buildAnalyticsTransport("Insights", { kind: "insights_project_summary", totalCount: 3, deterministicText: "x" }), undefined);
  assert.equal(buildAnalyticsTransport("Insights", { kind: "insights_overview", deterministicText: "x" }), undefined);
  assert.equal(buildAnalyticsTransport("Insights", null), undefined);
});

test("15. transport never carries a DB identifier - only display labels/values", () => {
  const transport = buildAnalyticsTransport("Insights", { ...valueRankingData("quotation_value"), clientId: "7f1c-uuid" })!;
  assert.ok(!JSON.stringify(transport).includes("7f1c"));
  assert.ok(!/\bclientId\b/.test(sliceFunctionBody(orchestrator, orchestrator.indexOf("function buildClientRankingTransport("))));
});

test("16. no duplicate prose: the analytics card and the plain text bubble remain mutually exclusive branches", () => {
  const ternaryStart = messages.indexOf("{hasAttentionCards && message.attention ? (");
  const ternaryBody = messages.slice(ternaryStart, ternaryStart + 1000);
  assert.ok(ternaryBody.includes("hasAnalyticsCards && message.analytics ? ("));
  assert.equal((messages.match(/<p\b/g) ?? []).length, 1);
});

test("17. ranking list UI: numbered rows, wrapping label, per-group heading, no table/horizontal scroll/buttons", () => {
  const start = messages.indexOf("function NoaAnalyticsRankingList(");
  assert.ok(start !== -1);
  const body = sliceFunctionBody(messages, start);
  assert.ok(body.includes("{row.rank}."));
  assert.ok(body.includes("min-w-0 flex-1 break-words"));
  assert.ok(body.includes("group.heading ?"));
  assert.ok(!/<table|overflow-x|<button|onClick/.test(body));
  const cardsBody = sliceFunctionBody(messages, messages.indexOf("function NoaAnalyticsCards("));
  assert.ok(cardsBody.includes("analytics.rankings.map((group, index) =>"));
});

test("18. mobile: odd metric tile spans both columns, card keeps the C1.2 max-width container", () => {
  const cardsBody = sliceFunctionBody(messages, messages.indexOf("function NoaAnalyticsCards("));
  assert.ok(cardsBody.includes("[&>*:last-child:nth-child(odd)]:col-span-2"));
  assert.ok(cardsBody.includes("flex w-full max-w-[92%] flex-col gap-2.5 rounded-2xl"));
  assert.ok(cardsBody.includes('{analytics.statusLabel ?? "Status"}'));
});

test("19. transport type gains only additive optional fields/kinds - C1 kinds still present", () => {
  const typeRegion = types.slice(types.indexOf("export type NoaAnalyticsTransport"), types.indexOf("export type NoaMessage = {"));
  for (const kind of ["quotation_analytics", "quotation_compare", "quotation_trend", "project_file_analytics", "client_analytics"]) {
    assert.ok(typeRegion.includes(`"${kind}"`), kind);
  }
  assert.ok(typeRegion.includes("rankings?: NoaAnalyticsRankingGroup[];"));
});

test("20. Attention/Catch-Up UI unaffected - components still render first in priority order; capability files untouched", () => {
  const ternaryStart = messages.indexOf("{hasAttentionCards && message.attention ? (");
  const ternaryBody = messages.slice(ternaryStart, ternaryStart + 300).replace(/\r\n/g, "\n");
  assert.ok(ternaryBody.startsWith("{hasAttentionCards && message.attention ? (\n              <NoaAttentionCards attention={message.attention} />\n            ) : hasCatchUpTimeline && message.catchUp ? ("));
  for (const source of [attentionCapability, catchUpReader]) {
    assert.ok(!/N2C2\.1|N2C3|N2C4/.test(source));
  }
});

test("21. C2 calculations untouched - aggregate/ranking functions carry no N2C2.1 marker", () => {
  for (const name of ["function buildProjectFileAggregate(", "async function clientRankingAnswer(", "function rankClientsByCurrency(", "async function projectFileAnalyticsAnswer("]) {
    assert.ok(!sliceFunctionBody(insights, insights.indexOf(name)).includes("N2C2.1"), name);
  }
});
