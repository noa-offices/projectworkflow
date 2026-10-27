import assert from "node:assert/strict";
import test, { mock } from "node:test";

const ok = async () => ({ ok: true, data: {}, sources: [{ label: "Fake", type: "product" }] });
mock.module("@/lib/noa/noa-product-capability.server", { namedExports: { fetchNoaProductCapability: ok } });
mock.module("@/lib/noa/noa-price-capability.server", { namedExports: { fetchNoaPriceCapability: ok } });
mock.module("@/lib/noa/noa-quotation-capability.server", { namedExports: { fetchNoaQuotationCapability: ok } });
mock.module("@/lib/noa/noa-attention-capability.server", { namedExports: { fetchNoaAttentionCapability: ok } });
mock.module("@/lib/noa/noa-user-activity-capability.server", { namedExports: { fetchNoaUserActivityCapability: ok } });
const insightMessages: string[] = [];
mock.module("@/lib/noa/noa-insights-capability.server", { namedExports: { fetchNoaInsightsCapability: async (message: string) => { insightMessages.push(message); return ok(); } } });
const { createNoaAgentTools } = await import("./noa-agent-tools.server");

test("NOA v2 exposes exactly 7 read-only tools", async () => {
  const { tools, sources } = createNoaAgentTools({ pathname: "", section: "other" });
  const names = Object.keys(tools);
  assert.deepEqual(names.sort(), ["getAttentionItems", "getInsights", "getProductPrice", "getQuotation", "getTeamActivity", "searchProducts", "searchQuotations"]);
  for (const name of names) assert.doesNotMatch(name, /create|update|delete|archive/i);
  await (tools.searchProducts as unknown as { execute: (i: { query: string }, o: unknown) => Promise<unknown> }).execute({ query: "chair" }, {});
  assert.equal(sources.length, 1, "sources are collected from successful results");
});

test("getInsights sends only closed canonical messages to the Insights capability", async () => {
  const { tools } = createNoaAgentTools({ pathname: "", section: "other" });
  const insights = tools.getInsights as unknown as { execute: (i: { report: string; period?: string }, o: unknown) => Promise<unknown>; inputSchema: { safeParse: (v: unknown) => { success: boolean } } };
  await insights.execute({ report: "quotation_analytics", period: "last_month" }, {});
  await insights.execute({ report: "quotation_summary" }, {});
  await insights.execute({ report: "top_clients_by_quotation_value" }, {});
  assert.deepEqual(insightMessages, ["quotation analytics last month", "quotation summary this month", "top clients by quotation value"]);
  assert.equal(insights.inputSchema.safeParse({ report: "sales by salesperson" }).success, false, "free text is rejected");
});
