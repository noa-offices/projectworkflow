// NOA 2.0C-3: Product / Brand / Category analytics under the existing Insights domain. Counts
// only, from existing Product Template / Brand / Category data, reusing the existing price-state
// helper. The real Insights functions are extracted from source, type-stripped with the repo's
// own TypeScript compiler, and executed against a fake, recording Supabase client (the capability
// file itself imports "server-only" and can't be imported under plain Node) - same "extract the
// real function" convention as noa-phase-n2c2-safety.test.mts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { brandPriceBaselineDate, latestBrandPriceListUpdate, productTemplatePriceCheckState } from "../product-price-check.js";
import { classifyNoaRoute } from "./noa-intent-router.js";

const insights = readFileSync("lib/noa/noa-insights-capability.server.ts", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const messages = readFileSync("components/noa/noa-messages.tsx", "utf8");

function sliceFunctionBody(src: string, startIndex: number): string {
  const rest = src.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

function extractFunction(src: string, signature: string): string {
  const start = src.indexOf(signature);
  assert.ok(start !== -1, `missing ${signature}`);
  return sliceFunctionBody(src, start) + "\n}\n";
}

function extractConst(src: string, name: string): string {
  const start = src.indexOf(`const ${name}`);
  assert.ok(start !== -1, `missing const ${name}`);
  return src.slice(start, src.indexOf(";", start) + 1) + "\n";
}

function transpile(source: string): string {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

type Query = { filters: unknown[][]; head: boolean; limit?: number; select?: string; table: string };

function fakeSupabase(resolve: (query: Query) => { count?: number | null; data?: unknown }) {
  const queries: Query[] = [];
  return {
    queries,
    from(table: string) {
      const query: Query = { filters: [], head: false, table };
      queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of ["eq", "not", "or", "in", "order", "gte", "lte"]) {
        builder[method] = (...args: unknown[]) => { query.filters.push([method, ...args]); return builder; };
      }
      builder.select = (columns: string, options?: { head?: boolean }) => { query.select = columns; query.head = Boolean(options?.head); return builder; };
      builder.limit = (value: number) => { query.limit = value; return builder; };
      builder.returns = () => builder;
      builder.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve(query)).then(onFulfilled, onRejected);
      return builder;
    },
  };
}

// ── real extracted functions ────────────────────────────────────────────────────────────────────
const productSource = [
  extractConst(insights, "MAX_PRICE_SCAN"),
  extractConst(insights, "MAX_PRODUCT_RANKING_ROWS"),
  extractConst(insights, "PRODUCT_PRICE_STATUS_ORDER"),
  extractFunction(insights, "function rankByProductCount("),
  extractFunction(insights, "async function productPriceStatusCounts("),
  extractFunction(insights, "async function productAnalyticsAnswer("),
  extractFunction(insights, "async function productPriceSummaryAnswer("),
].join("\n");
const productModule = new Function(
  "productTemplatePriceCheckState",
  "brandPriceBaselineDate",
  "latestBrandPriceListUpdate",
  `${transpile(productSource)}\nreturn { productAnalyticsAnswer, productPriceSummaryAnswer };`,
)(productTemplatePriceCheckState, brandPriceBaselineDate, latestBrandPriceListUpdate) as {
  productAnalyticsAnswer: (supabase: unknown) => Promise<{ data: Record<string, unknown>; ok: boolean }>;
  productPriceSummaryAnswer: (supabase: unknown) => Promise<{ data: Record<string, unknown>; ok: boolean }>;
};

const classifierStart = insights.indexOf("function insightsQuestionKind(message: string): InsightsQuestionKind {");
const classifierSource = sliceFunctionBody(insights, classifierStart) + "\n}";
const insightsQuestionKind = new Function(classifierSource.replace(
  "function insightsQuestionKind(message: string): InsightsQuestionKind {",
  "return function(message) {",
))() as (message: string) => string;

const regionStart = orchestrator.indexOf("type NoaQuotationAnalyticsData");
const dispatchStart = orchestrator.indexOf("function buildAnalyticsTransport(");
const buildAnalyticsTransport = new Function(`${transpile(orchestrator.slice(regionStart, dispatchStart) + extractFunction(orchestrator, "function buildAnalyticsTransport("))}\nreturn buildAnalyticsTransport;`)() as (domain: string, data: unknown) => {
  kind: string; metrics?: Array<{ key: string; value: string }>; statusBreakdown?: Array<{ label: string; count: number }>; statusLabel?: string;
  rankings?: Array<{ heading?: string; rows: Array<{ rank: number; label: string; value: string }> }>; note?: string; emptyMessage?: string;
} | undefined;

// ── fixture: 2 brands, brand-scoped duplicate "Chairs" categories, archived/discontinued rows ─────
const templates = [
  { brand_id: "b-las", created_at: "2024-01-01", id: "t1", last_price_checked_at: null, lifecycle_status: "active", main_category_id: "c-las-chairs", price_check_interval_days: 90, template_name: "A chair" },
  { brand_id: "b-las", created_at: "2024-01-01", id: "t2", last_price_checked_at: null, lifecycle_status: "active", main_category_id: "c-las-desks", price_check_interval_days: 90, template_name: "B desk" },
  { brand_id: "b-las", created_at: "2024-01-01", id: "t3", last_price_checked_at: null, lifecycle_status: "active", main_category_id: "c-las-chairs", price_check_interval_days: 90, template_name: "C chair" },
  { brand_id: "b-inter", created_at: "2024-01-01", id: "t4", last_price_checked_at: null, lifecycle_status: "active", main_category_id: "c-inter-chairs", price_check_interval_days: 90, template_name: "D chair" },
  { brand_id: "b-inter", created_at: "2024-01-01", id: "t5", last_price_checked_at: null, lifecycle_status: "active", main_category_id: null, price_check_interval_days: 90, template_name: "E misc" },
  // is_active but lifecycle discontinued: counted for price status (same set as price summary), never ranked
  { brand_id: "b-inter", created_at: "2024-01-01", id: "t6", last_price_checked_at: null, lifecycle_status: "discontinued", main_category_id: "c-inter-chairs", price_check_interval_days: 90, template_name: "F old chair" },
];

function productResolver(overrides: { total?: number; scanTotal?: number; rows?: typeof templates } = {}) {
  const rows = overrides.rows ?? templates;
  return (query: Query) => {
    if (query.table === "product_templates" && query.head) {
      const filters = JSON.stringify(query.filters);
      if (filters.includes('"not"')) return { count: 5 };
      if (filters.includes('"or"')) return { count: 3 };
      if (filters.includes('"discontinued"')) return { count: 1 };
      return { count: overrides.total ?? 9 };
    }
    if (query.table === "product_templates") return { count: overrides.scanTotal ?? rows.length, data: rows };
    if (query.table === "brands") return { data: [{ id: "b-las", last_price_list_checked_at: null, name: "LAS" }, { id: "b-inter", last_price_list_checked_at: null, name: "Interstuhl" }] };
    if (query.table === "brand_price_list_updates") return { data: [] };
    if (query.table === "product_categories") return { data: [{ id: "c-las-chairs", name: "Chairs" }, { id: "c-las-desks", name: "Desks" }, { id: "c-inter-chairs", name: "chairs " }] };
    throw new Error(`unexpected table ${query.table}`);
  };
}

test("1. routing: canonical product analytics/ranking phrases route to Insights", () => {
  for (const message of ["product analytics", "product summary", "products by brand", "top brands by product count", "products by category", "top categories by product count", "Product analytics?"]) {
    assert.equal(classifyNoaRoute(message, { pathname: "/", section: "dashboard" }), "Insights", message);
  }
});

test("2. routing: current-state Product/Price phrases keep their existing routes", () => {
  const cases: Array<[string, string]> = [
    ["show products", "Product"],
    ["how many products do we have", "Product"],
    ["how many active products", "Product"],
    ["how many archived products", "Product"],
    ["show LAS chairs model", "Product"],
    ["which products need a price check", "Price"],
    ["how many products need price check", "Price"],
    ["how many products are due for price check", "Price"],
    ["product price status", "Price"],
    ["product price summary", "Insights"],
  ];
  for (const [message, route] of cases) {
    assert.equal(classifyNoaRoute(message, { pathname: "/", section: "dashboard" }), route, message);
  }
});

test("3. classifier: product analytics phrases resolve to product_analytics; product price summary is unchanged", () => {
  for (const message of ["product analytics", "product summary", "products by brand", "product count by category", "top brands by product count", "top categories by product count"]) {
    assert.equal(insightsQuestionKind(message), "product_analytics", message);
  }
  assert.equal(insightsQuestionKind("product price summary"), "product_price_summary");
  assert.equal(insightsQuestionKind("project analytics"), "project_file_analytics");
  assert.equal(insightsQuestionKind("quotation analytics"), "quotation_analytics");
});

test("4. lifecycle counts: total/active/archived/discontinued come from exact head counts mirroring normalizeTemplateLifecycleStatus", async () => {
  const supabase = fakeSupabase(productResolver());
  const result = await productModule.productAnalyticsAnswer(supabase);
  assert.equal(result.data.totalCount, 9);
  assert.equal(result.data.activeCount, 5);
  assert.equal(result.data.archivedCount, 3);
  assert.equal(result.data.discontinuedCount, 1);
  const heads = supabase.queries.filter((query) => query.head);
  assert.equal(heads.length, 4);
  assert.ok(heads.every((query) => query.select === "id"));
  const filterText = JSON.stringify(heads.map((query) => query.filters));
  assert.ok(filterText.includes('["not","lifecycle_status","in","(archived,discontinued)"]'));
  assert.ok(filterText.includes("lifecycle_status.eq.archived,and(is_active.eq.false,lifecycle_status.eq.active)"));
});

test("5. brand grouping: lifecycle-active templates counted per brand, deterministic ranking", async () => {
  const result = await productModule.productAnalyticsAnswer(fakeSupabase(productResolver()));
  assert.deepEqual(result.data.brandRanking, [{ count: 3, name: "LAS" }, { count: 2, name: "Interstuhl" }]);
});

test("6. category grouping: brand-scoped categories with the same name are grouped by name; uncategorized is reported, not ranked; discontinued never ranked", async () => {
  const result = await productModule.productAnalyticsAnswer(fakeSupabase(productResolver()));
  assert.deepEqual(result.data.categoryRanking, [{ count: 3, name: "Chairs" }, { count: 1, name: "Desks" }]);
  assert.equal(result.data.uncategorizedCount, 1);
});

test("7. price-status counts reuse productTemplatePriceCheckState over the SAME set as the existing price summary (identical numbers)", async () => {
  const analytics = await productModule.productAnalyticsAnswer(fakeSupabase(productResolver()));
  const summary = await productModule.productPriceSummaryAnswer(fakeSupabase(productResolver()));
  const analyticsCounts = Object.fromEntries((analytics.data.priceStatus as Array<{ key: string; count: number }>).map((row) => [row.key, row.count]));
  assert.deepEqual(analyticsCounts, summary.data.statusCounts);
  const total = (analytics.data.priceStatus as Array<{ count: number }>).reduce((sum, row) => sum + row.count, 0);
  assert.equal(total, templates.length);
  const expected = productTemplatePriceCheckState({ brandPriceBaselineAt: null, formatDate: (value: string | null) => value ?? "unknown date", latestBrandPriceListUpdate: null, template: templates[0] });
  assert.equal((analytics.data.priceStatus as Array<{ label: string }>)[0].label, expected.label);
});

test("8. deterministic ranking: ties break by name, capped at MAX_PRODUCT_RANKING_ROWS", async () => {
  const many = Array.from({ length: 14 }, (_, index) => ({ ...templates[0], brand_id: `b${String(index).padStart(2, "0")}`, id: `x${index}`, main_category_id: null }));
  const resolver = productResolver({ rows: many });
  const supabase = fakeSupabase((query) => query.table === "brands"
    ? { data: many.map((row) => ({ id: row.brand_id, last_price_list_checked_at: null, name: `Brand ${row.brand_id}` })) }
    : resolver(query));
  const result = await productModule.productAnalyticsAnswer(supabase);
  const ranking = result.data.brandRanking as Array<{ name: string }>;
  assert.equal(ranking.length, 10);
  assert.deepEqual(ranking.slice(0, 2).map((row) => row.name), ["Brand b00", "Brand b01"]);
});

test("9. empty state: no templates -> clean empty answer, no further reads", async () => {
  const supabase = fakeSupabase(productResolver({ rows: [], scanTotal: 0, total: 0 }));
  const result = await productModule.productAnalyticsAnswer(supabase);
  assert.equal(result.data.totalCount, 0);
  assert.equal(result.data.deterministicText, "There are no product templates in the Product Library yet.");
  assert.ok(!supabase.queries.some((query) => query.table === "brands" || query.table === "product_categories"));
  const transport = buildAnalyticsTransport("Insights", result.data)!;
  assert.equal(transport.emptyMessage, "There are no product templates in the Product Library yet.");
});

test("10. bounded queries: the one row scan reuses MAX_PRICE_SCAN; lifecycle counts are head-only; no select *", async () => {
  const supabase = fakeSupabase(productResolver());
  await productModule.productAnalyticsAnswer(supabase);
  const rowScans = supabase.queries.filter((query) => query.table === "product_templates" && !query.head);
  assert.equal(rowScans.length, 1);
  assert.equal(rowScans[0].limit, 200);
  assert.ok(JSON.stringify(rowScans[0].filters).includes('["eq","is_active",true]'));
  assert.equal(supabase.queries.filter((query) => query.table === "brands").length, 1, "brand names come from the price helper's own brands read - no second brands read");
  assert.ok(!insights.includes('.select("*")'));
});

test("11. scan cap is disclosed, never silently extrapolated", async () => {
  const result = await productModule.productAnalyticsAnswer(fakeSupabase(productResolver({ scanTotal: 450 })));
  assert.equal(result.data.scanCapped, true);
  assert.match(String(result.data.deterministicText), /based on the first 6 of 450 active templates/);
  const transport = buildAnalyticsTransport("Insights", result.data)!;
  assert.match(transport.note ?? "", /first 6 of 450/);
});

test("12. auth preserved: product_analytics requires requireProductLibraryManager() before any read", () => {
  const kindIndex = insights.indexOf('if (kind === "product_analytics") {');
  const requireIndex = insights.indexOf("await requireProductLibraryManager();", kindIndex);
  const callIndex = insights.indexOf("return productAnalyticsAnswer(supabase);", kindIndex);
  assert.ok(kindIndex !== -1 && requireIndex > kindIndex && callIndex > requireIndex);
  assert.ok(insights.includes("return PRODUCT_ANALYTICS_UNAUTHORIZED_RESULT;"));
});

test("13. no invented commercial metrics (sales/revenue/popularity/margin/stock) in the product analytics code", () => {
  const body = extractFunction(insights, "async function productAnalyticsAnswer(") + extractFunction(orchestrator, "function buildProductAnalyticsTransport(");
  assert.ok(!/revenue|best[- ]?selling|popular|margin|profit|stock|sales|conversion/i.test(body));
  assert.ok(!/grand_total|unit_price/.test(body));
});

test("14. product transport: lifecycle tiles, price-status chips with their own heading, count rankings without currency", async () => {
  const result = await productModule.productAnalyticsAnswer(fakeSupabase(productResolver()));
  const transport = buildAnalyticsTransport("Insights", result.data)!;
  assert.equal(transport.kind, "product_analytics");
  assert.deepEqual(transport.metrics?.map((metric) => metric.value), ["9", "5", "3", "1"]);
  assert.equal(transport.statusLabel, "Price status");
  assert.deepEqual(transport.rankings?.map((group) => group.heading), ["Top brands by product count", "Top categories by product count"]);
  assert.deepEqual(transport.rankings?.[0].rows[0], { label: "LAS", rank: 1, value: "3" });
  assert.ok(!/AED|USD/.test(JSON.stringify(transport)));
  assert.match(transport.note ?? "", /1 active template has no main category/);
});

test("15. product price summary output shape is unchanged by the helper extraction", () => {
  const body = extractFunction(insights, "async function productPriceSummaryAnswer(");
  assert.ok(body.includes('kind: "insights_product_price_summary"'));
  assert.ok(body.includes("const { statusCounts } = await productPriceStatusCounts(supabase, templates);"));
  assert.ok(body.includes(".limit(MAX_PRICE_SCAN)"));
  assert.ok(!body.includes("deterministicOnly"));
});

test("16. C1/C2 unaffected: quotation/client/project classifier results unchanged; cards UI still the single analytics component", () => {
  assert.equal(insightsQuestionKind("top clients by quotation value"), "client_ranking");
  assert.equal(insightsQuestionKind("how many quotations this month"), "quotation_summary");
  assert.equal(insightsQuestionKind("project file analytics"), "project_file_analytics");
  assert.equal(insightsQuestionKind("client summary"), "client_summary");
  assert.equal((messages.match(/function NoaAnalyticsCards\(/g) ?? []).length, 1);
});
