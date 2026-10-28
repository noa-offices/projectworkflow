import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { z } from "zod";

const ok = async () => ({ ok: true, data: {}, sources: [{ label: "Fake", type: "product" }] });
const seen: string[] = [];
const seenOptions: unknown[] = [];
const activityMessages: string[] = [];
const activityOptions: unknown[] = [];
const record = async (message: string, _context?: unknown, options?: unknown) => { seen.push(message); seenOptions.push(options); return ok(); };
mock.module("@/lib/noa/noa-product-capability.server", { namedExports: { fetchNoaProductCapability: record } });
mock.module("@/lib/noa/noa-price-capability.server", { namedExports: { fetchNoaPriceCapability: record } });
mock.module("@/lib/noa/noa-quotation-capability.server", { namedExports: { fetchNoaQuotationCapability: ok } });
mock.module("@/lib/noa/noa-attention-capability.server", { namedExports: { fetchNoaAttentionCapability: ok } });
mock.module("@/lib/noa/noa-user-activity-capability.server", { namedExports: { fetchNoaUserActivityCapability: async (message: string, _context?: unknown, options?: unknown) => { activityMessages.push(message); activityOptions.push(options); return ok(); } } });
mock.module("@/lib/noa/noa-client-capability.server", { namedExports: { fetchNoaClientCapability: record } });
mock.module("@/lib/noa/noa-project-capability.server", { namedExports: { fetchNoaProjectCapability: record } });
mock.module("@/lib/noa/noa-procurement-capability.server", { namedExports: { fetchNoaProcurementCapability: record } });
const inventoryCalls: unknown[] = [];
mock.module("@/lib/noa/noa-inventory-capability.server", { namedExports: { INVENTORY_REPORTS: ["list", "count", "item_stock", "low_stock", "by_location", "by_category"], INVENTORY_LOCATIONS: ["warehouse", "dubai_showroom", "abudhabi_showroom", "mockup", "temporary_out"], fetchNoaInventoryCapability: async (options: unknown) => { inventoryCalls.push(options); return ok(); } } });
const insightMessages: string[] = [];
const insightOptions: unknown[] = [];
mock.module("@/lib/noa/noa-insights-capability.server", { namedExports: { fetchNoaInsightsCapability: async (message: string, _context?: unknown, options?: unknown) => { insightMessages.push(message); insightOptions.push(options); return ok(); } } });
const orchestratorRequests: unknown[] = [];
const configurationFixture = { domain: "Product", sources: [], text: "Which finish?", choices: [{ id: "oak", label: "Oak" }], productConfigurationReference: { templateId: "t-1", mode: "configuring", selections: {} } };
mock.module("@/lib/noa/noa-orchestrator", { namedExports: { runNoaOrchestrator: async (request: unknown) => { orchestratorRequests.push(request); return configurationFixture; } } });
const { createNoaAgentTools, PRODUCT_MESSAGES, PRICE_MESSAGES, PRODUCT_DETAIL_MESSAGE, PRICE_SINGLE_MESSAGE } = await import("./noa-agent-tools.server");

test("NOA v2 exposes exactly 12 read-only tools", async () => {
  const { tools, sources } = createNoaAgentTools({ pathname: "", section: "other" });
  const names = Object.keys(tools);
  assert.deepEqual(names.sort(), ["configureProduct", "getAttentionItems", "getClientInfo", "getInsights", "getInventoryInfo", "getProcurementInfo", "getProductPrice", "getProjectInfo", "getQuotation", "getTeamActivity", "searchProducts", "searchQuotations"]);
  for (const name of names) assert.doesNotMatch(name, /create|update|delete|archive/i);
  await (tools.searchProducts as unknown as { execute: (i: { request: string; term: string }, o: unknown) => Promise<unknown> }).execute({ request: "list", term: "chairs" }, {});
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

test("getInsights sales_by_salesperson sends the structured option; other reports send none", async () => {
  const { tools } = createNoaAgentTools({ pathname: "", section: "other" });
  const insights = tools.getInsights as unknown as Closed;
  insightMessages.length = 0; insightOptions.length = 0;
  await insights.execute({ report: "sales_by_salesperson", period: "last_month" }, {});
  await insights.execute({ report: "quotation_summary" }, {});
  assert.deepEqual(insightOptions, [{ report: "sales_by_salesperson" }, undefined]);
  assert.equal(insights.inputSchema.safeParse({ report: "sales_by_salesperson" }).success, true);
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
  await bad(tools.searchProducts as unknown as Closed, { request: "list", term: "" }); await bad(tools.searchProducts as unknown as Closed, { request: "list", term: "show all chairs" }); await bad(tools.getProductPrice as unknown as Closed, { request: "single", term: "x".repeat(81) }); await bad(tools.getProductPrice as unknown as Closed, { request: "single", term: "chair; drop table" }); await bad(tools.getQuotation as unknown as Closed, { quotationNumber: "q".repeat(101) });
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

test("getInventoryInfo passes typed options and rejects bad text in execute, before the capability", async () => {
  const { tools } = createNoaAgentTools({ pathname: "", section: "other" });
  const inventory = tools.getInventoryInfo as unknown as Closed;
  inventoryCalls.length = 0;
  await inventory.execute({ report: "by_location", location: "mockup", term: "  chair " }, {});
  assert.deepEqual(inventoryCalls, [{ report: "by_location", location: "mockup", term: "chair" }]);
  assert.equal(inventory.inputSchema.safeParse({ report: "cost" }).success, false);
  assert.equal(inventory.inputSchema.safeParse({ report: "list", location: "sold" }).success, false);
  for (const term of ["100%", "a_b", "x".repeat(81), "", "a,b", "(x)"]) assert.equal(((await inventory.execute({ report: "list", term }, {})) as { ok: boolean }).ok, false, term);
  assert.equal(((await inventory.execute({ report: "list", category: "x".repeat(81) }, {})) as { ok: boolean }).ok, false);
  assert.equal(inventoryCalls.length, 1, "invalid input never reaches the capability");
});

// The real classifiers are private to the old capability files (server-only, not exported), and old files stay untouched, so these mirror
// the exact regexes of productQuestionKind (noa-product-capability.server.ts) and priceQuestionKind (noa-price-capability.server.ts).
const productKind = (m: string) => /\b(how many|count|number of)\b/.test(m.toLowerCase()) ? "count" : /\b(show|list|all|which)\b/.test(m.toLowerCase()) ? "list" : "detail";
const priceKind = (m: string) => /\b(summarize|summary|overall|every|all|how many|count|number of)\b/.test(m.toLowerCase()) ? "summary" : /\b(which|show|list)\b/.test(m.toLowerCase()) ? "list" : "detail";

test("product and price tools build the exact messages the capability classifiers expect", async () => {
  assert.equal(PRODUCT_MESSAGES.list("chairs"), "show all chairs"); assert.equal(productKind(PRODUCT_MESSAGES.list("chairs")), "list");
  assert.equal(PRODUCT_MESSAGES.count("chairs"), "how many chairs"); assert.equal(productKind(PRODUCT_MESSAGES.count("chairs")), "count");
  assert.equal(PRODUCT_DETAIL_MESSAGE, "give me the product information"); assert.equal(productKind(PRODUCT_DETAIL_MESSAGE), "detail");
  assert.equal(PRICE_SINGLE_MESSAGE, "give me the product price"); assert.equal(priceKind(PRICE_SINGLE_MESSAGE), "detail");
  assert.equal(PRICE_MESSAGES.status_summary("chairs"), "summarize chairs price status"); assert.equal(priceKind(PRICE_MESSAGES.status_summary("chairs")), "summary");
  const { tools } = createNoaAgentTools({ pathname: "", section: "other" });
  seen.length = 0;
  const search = tools.searchProducts as unknown as Closed, price = tools.getProductPrice as unknown as Closed;
  await search.execute({ request: "list", term: " chairs " }, {}); await search.execute({ request: "count", term: "chairs" }, {}); await search.execute({ request: "detail", term: "ABC-100" }, {});
  await price.execute({ request: "single", term: "Aria lounge" }, {}); await price.execute({ request: "status_summary", term: "chairs" }, {});
  assert.deepEqual(seen, ["show all chairs", "how many chairs", PRODUCT_DETAIL_MESSAGE, PRICE_SINGLE_MESSAGE, "summarize chairs price status"]);
});

test("detail and single send a fixed sentence plus the name in options.product.productText; a product named Every works", async () => {
  const { tools } = createNoaAgentTools({ pathname: "", section: "other" });
  const search = tools.searchProducts as unknown as Closed, price = tools.getProductPrice as unknown as Closed;
  seen.length = 0; seenOptions.length = 0;
  assert.equal(((await search.execute({ request: "detail", term: "Every" }, {})) as { ok: boolean }).ok, true);
  assert.equal(((await price.execute({ request: "single", term: " All " }, {})) as { ok: boolean }).ok, true);
  assert.deepEqual(seen, [PRODUCT_DETAIL_MESSAGE, PRICE_SINGLE_MESSAGE]);
  assert.deepEqual(seenOptions, [{ product: { productText: "Every" } }, { product: { productText: "All" } }]);
  for (const message of seen) { assert.doesNotMatch(message, /Every|All/i); assert.equal(productKind(message), "detail"); assert.equal(priceKind(message), "detail"); }
  assert.doesNotMatch(PRODUCT_DETAIL_MESSAGE + " " + PRICE_SINGLE_MESSAGE, /\b(all|every|list|show|which|count|number of|how many|summary|summarize|overall|this)\b/i);
});

test("list, count and status_summary still refuse keyword terms; detail and single still enforce the other term rules", async () => {
  const { tools } = createNoaAgentTools({ pathname: "", section: "other" });
  const search = tools.searchProducts as unknown as Closed, price = tools.getProductPrice as unknown as Closed;
  seen.length = 0;
  const refused = async (tool: Closed, input: unknown) => assert.equal(((await tool.execute(input, {})) as { ok: boolean }).ok, false, JSON.stringify(input));
  await refused(search, { request: "list", term: "Every" }); await refused(search, { request: "count", term: "all chairs" }); await refused(price, { request: "status_summary", term: "Every" });
  await refused(search, { request: "detail", term: "x".repeat(81) }); await refused(search, { request: "detail", term: "Every; drop" }); await refused(price, { request: "single", term: "" });
  assert.deepEqual(seen, [], "nothing reached a capability");
});

test("getTeamActivity details: own today/yesterday and QN/CO references send exact messages; bad references never reach the capability; team details send a structured request", async () => {
  const { tools } = createNoaAgentTools({ pathname: "", section: "other" });
  const activity = tools.getTeamActivity as unknown as Closed;
  const run = async (input: unknown) => (await activity.execute(input, {})) as { ok: boolean };
  activityMessages.length = 0;
  await run({ scope: "mine", period: "today", request: "details" }); await run({ scope: "mine", period: "yesterday", request: "details" });
  await run({ scope: "mine", period: "today", request: "details", reference: " qn-0005-001 " }); await run({ scope: "team", period: "today", request: "details", reference: "CO-0003-001" });
  assert.deepEqual(activityMessages, ["what changed today", "what changed yesterday", "what changed on QN-0005-001", "what changed on CO-0003-001"]);
  assert.deepEqual(activityOptions, [undefined, undefined, undefined, undefined], "own and reference details send no semantic request");
  activityMessages.length = 0;
  assert.equal((await run({ scope: "mine", period: "today", request: "details", reference: "QN-5" })).ok, false);
  assert.equal((await run({ scope: "mine", period: "today", request: "details", reference: "what changed on QN-0005-001 and more" })).ok, false);
  assert.deepEqual(activityMessages, [], "refused requests never reach the capability");
  activityOptions.length = 0;
  assert.equal((await run({ scope: "team", period: "today", request: "details" })).ok, true);
  await run({ scope: "team", period: "yesterday", request: "details" });
  assert.deepEqual(activityMessages, ["show team activity today", "show team activity yesterday"]);
  const teamRequest = { semanticRequest: { domain: "UserActivity", intent: "recorded_activity", subject: { type: "team" }, detail: "events" } };
  assert.deepEqual(activityOptions, [teamRequest, teamRequest], "team details are chosen by the structured request");
  activityMessages.length = 0; activityOptions.length = 0;
  await run({ scope: "team", period: "today" }); await run({ scope: "mine", period: "yesterday", request: "summary" });
  assert.deepEqual(activityMessages, ["show team activity today", "show my activity yesterday"]);
});

test("configureProduct starts the old guided flow with exactly 'configure <term>' and returns the answer untouched", async () => {
  const { tools, getConfigurationAnswer } = createNoaAgentTools({ pathname: "/products", section: "other" }, { displayName: "Sam" });
  const configure = tools.configureProduct as unknown as Closed;
  orchestratorRequests.length = 0;
  assert.equal(getConfigurationAnswer(), null);
  assert.deepEqual(await configure.execute({ product: " Every " }, {}), { ok: true, started: true });
  assert.deepEqual(orchestratorRequests, [{ context: { pathname: "/products", section: "other" }, message: "configure Every", recentMessages: [], displayName: "Sam" }]);
  assert.equal(getConfigurationAnswer(), configurationFixture, "text, choices and productConfigurationReference come back unchanged (same object)");
  for (const bad of ["", "x".repeat(81), "Every; drop table", "<b>Every</b>"]) {
    orchestratorRequests.length = 0;
    const refused = await (createNoaAgentTools({ pathname: "", section: "other" }).tools.configureProduct as unknown as Closed).execute({ product: bad }, {}) as { ok: boolean };
    assert.equal(refused.ok, false, bad); assert.deepEqual(orchestratorRequests, []);
  }
});
