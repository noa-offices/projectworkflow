import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { z } from "zod";

const ok = async () => ({ ok: true, data: {}, sources: [{ label: "Fake", type: "product" }] });
mock.module("@/lib/noa/noa-product-capability.server", { namedExports: { fetchNoaProductCapability: ok } });
mock.module("@/lib/noa/noa-price-capability.server", { namedExports: { fetchNoaPriceCapability: ok } });
mock.module("@/lib/noa/noa-quotation-capability.server", { namedExports: { fetchNoaQuotationCapability: ok } });
mock.module("@/lib/noa/noa-attention-capability.server", { namedExports: { fetchNoaAttentionCapability: ok } });
mock.module("@/lib/noa/noa-user-activity-capability.server", { namedExports: { fetchNoaUserActivityCapability: ok } });
const seen: string[] = [];
const record = async (message: string) => { seen.push(message); return ok(); };
mock.module("@/lib/noa/noa-client-capability.server", { namedExports: { fetchNoaClientCapability: record } });
mock.module("@/lib/noa/noa-project-capability.server", { namedExports: { fetchNoaProjectCapability: record } });
mock.module("@/lib/noa/noa-procurement-capability.server", { namedExports: { fetchNoaProcurementCapability: record } });
const insightMessages: string[] = [];
mock.module("@/lib/noa/noa-insights-capability.server", { namedExports: { fetchNoaInsightsCapability: async (message: string) => { insightMessages.push(message); return ok(); } } });
const { createNoaAgentTools } = await import("./noa-agent-tools.server");

test("NOA v2 exposes exactly 10 read-only tools", async () => {
  const { tools, sources } = createNoaAgentTools({ pathname: "", section: "other" });
  const names = Object.keys(tools);
  assert.deepEqual(names.sort(), ["getAttentionItems", "getClientInfo", "getInsights", "getProcurementInfo", "getProductPrice", "getProjectInfo", "getQuotation", "getTeamActivity", "searchProducts", "searchQuotations"]);
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

type Closed = { execute: (i: unknown, o: unknown) => Promise<unknown>; inputSchema: { safeParse: (v: unknown) => { success: boolean } } };
test("client, project and procurement tools send fixed templates around validated input", async () => {
  const { tools } = createNoaAgentTools({ pathname: "", section: "other" });
  const client = tools.getClientInfo as unknown as Closed, project = tools.getProjectInfo as unknown as Closed, procurement = tools.getProcurementInfo as unknown as Closed;
  seen.length = 0;
  await client.execute({ report: "detail", clientName: "Apex Interiors" }, {});
  await client.execute({ report: "projects", clientName: "Apex Interiors" }, {});
  await client.execute({ report: "count" }, {});
  await project.execute({ report: "detail", projectFileNumber: "CO-1234-56" }, {});
  await project.execute({ report: "active_count" }, {});
  await procurement.execute({ report: "order_detail", orderNumber: "PW-2024-001" }, {});
  await procurement.execute({ report: "completed_list" }, {});
  assert.deepEqual(seen, ["client details for Apex Interiors", "projects for client Apex Interiors", "how many clients are there", "project details for CO-1234-56", "how many active project files", "order details for PW-2024-001", "show completed procurement orders"]);
  seen.length = 0;
  const refused = await client.execute({ report: "detail", clientName: "Project Alpha" }, {}) as { ok: boolean };
  assert.equal(refused.ok, false); assert.deepEqual(seen, [], "a name that would flip the question kind never reaches the capability");
});

test("client, project and procurement tools reject invalid input in execute, before any capability call", async () => {
  const { tools } = createNoaAgentTools({ pathname: "", section: "other" });
  const client = tools.getClientInfo as unknown as Closed, project = tools.getProjectInfo as unknown as Closed, procurement = tools.getProcurementInfo as unknown as Closed;
  seen.length = 0;
  const bad = async (tool: Closed, input: unknown) => assert.equal(((await tool.execute(input, {})) as { ok: boolean }).ok, false, JSON.stringify(input).slice(0, 60));
  await bad(project, { report: "detail", projectFileNumber: "CO-12" }); await bad(project, { report: "detail", projectFileNumber: "tell me about CO-1234-56" });
  await bad(project, { report: "detail" }); await bad(project, { report: "active_list", projectFileNumber: "CO-1234-56" });
  await bad(client, { report: "detail", clientName: "x".repeat(81) }); await bad(client, { report: "detail", clientName: "Apex; drop table clients" });
  await bad(client, { report: "detail", clientName: "Apex <b>" }); await bad(client, { report: "projects" }); await bad(client, { report: "list", clientName: "Apex" });
  await bad(procurement, { report: "order_detail", orderNumber: "PW-2024-001 and vendors for all" }); await bad(procurement, { report: "order_detail", orderNumber: "x" });
  await bad(procurement, { report: "order_detail" }); await bad(procurement, { report: "active_list", orderNumber: "PW-2024-001" });
  await bad(tools.searchProducts as unknown as Closed, { query: "" }); await bad(tools.getQuotation as unknown as Closed, { quotationNumber: "q".repeat(101) });
  assert.deepEqual(seen, [], "no invalid input reaches a capability");
  assert.equal(project.inputSchema.safeParse({ report: "free text" }).success, false, "report stays a closed enum");
  const good = async (tool: Closed, input: unknown) => assert.equal(((await tool.execute(input, {})) as { ok: boolean }).ok, true, JSON.stringify(input));
  await good(client, { report: "detail", clientName: "Apex Interiors & Co. (UAE)" }); await good(project, { report: "detail", projectFileNumber: "CO-1234-56" }); await good(procurement, { report: "order_detail", orderNumber: "PW-2024-001" });
  assert.equal(seen.length, 3);
});

test("no tool schema sent to the model contains pattern, length, format or union keywords", () => {
  const { tools } = createNoaAgentTools({ pathname: "", section: "other" });
  const forbidden = new Set(["pattern", "minLength", "maxLength", "format", "oneOf", "anyOf", "allOf"]);
  const found: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) node.forEach((item, index) => walk(item, `${path}[${index}]`));
    else if (node && typeof node === "object") for (const [key, value] of Object.entries(node)) { if (forbidden.has(key)) found.push(`${path}.${key}`); walk(value, `${path}.${key}`); }
  };
  for (const [name, definition] of Object.entries(tools)) walk(z.toJSONSchema((definition as unknown as { inputSchema: z.ZodType }).inputSchema, { io: "input" }), name);
  assert.deepEqual(found, []);
});
