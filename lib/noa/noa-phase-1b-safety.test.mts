import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The orchestrator, capability, provider, route, and UI files all have "@/..." aliases (server
// auth/Supabase imports, or React/Next imports), which Node's plain ESM resolver can't resolve
// outside the Next.js build - the same limitation already documented for other "use client"/
// "use server"-adjacent files in this repo (see components/quotations/product-library-selector.test.mts
// for the established precedent). These are source-level wiring/safety checks, not runtime
// execution tests.

const productCapabilitySource = readFileSync("lib/noa/noa-product-capability.server.ts", "utf8");
const quotationCapabilitySource = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");
const priceCapabilitySource = readFileSync("lib/noa/noa-price-capability.server.ts", "utf8");
const providerSource = readFileSync("lib/noa/noa-provider.server.ts", "utf8");
const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const agentRegistrySource = readFileSync("lib/ai/agent-registry.ts", "utf8");
const routeSource = readFileSync("app/api/noa/chat/route.ts", "utf8");
const assistantSource = readFileSync("components/noa/noa-assistant.tsx", "utf8");

const CAPABILITY_FILES: Array<[string, string]> = [
  ["lib/noa/noa-product-capability.server.ts", productCapabilitySource],
  ["lib/noa/noa-quotation-capability.server.ts", quotationCapabilitySource],
  ["lib/noa/noa-price-capability.server.ts", priceCapabilitySource],
];

// C. Read-only safety ----------------------------------------------------------

test("no NOA capability file contains any mutation method call", () => {
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;
  for (const [file, source] of CAPABILITY_FILES) {
    assert.ok(!mutationPattern.test(source), `${file} must not call a mutation method`);
  }
  assert.ok(!mutationPattern.test(orchestratorSource), "orchestrator must not call a mutation method");
  assert.ok(!mutationPattern.test(providerSource), "provider must not call a mutation method");
});

test("no NOA file imports a service-role Supabase client", () => {
  const serviceRolePattern = /service[-_]?role|SUPABASE_SERVICE_ROLE/i;
  for (const [file, source] of [...CAPABILITY_FILES, ["lib/noa/noa-orchestrator.ts", orchestratorSource] as const, ["app/api/noa/chat/route.ts", routeSource] as const]) {
    assert.ok(!serviceRolePattern.test(source), `${file} must not reference a service-role client`);
    assert.ok(source.includes('from "@/lib/supabase/server"') || file === "lib/noa/noa-orchestrator.ts", `${file} should use the shared user-scoped Supabase client if it queries Supabase`);
  }
});

test("registry's NOA entry is read_only with canWrite:false and no write capability", () => {
  const noaEntryMatch = agentRegistrySource.match(/id: "noa_orchestrator",[\s\S]*?\}\),/);
  assert.ok(noaEntryMatch, "expected a noa_orchestrator entry in the agent registry");
  const entry = noaEntryMatch![0];
  assert.match(entry, /mode: "read_only"/);
  assert.match(entry, /canWrite: false/);
  assert.doesNotMatch(entry, /"write"|"mutate"|"insert"|"update"|"delete"/);
});

test("existing agents (source_qa, specification_enrichment, final_specification) are untouched", () => {
  for (const id of ["source_qa", "specification_enrichment", "final_specification"]) {
    assert.ok(agentRegistrySource.includes(`id: "${id}"`), `expected ${id} to still be registered`);
  }
});

// D. Product ---------------------------------------------------------------

test("product capability prefers context.productTemplateId before falling back to text search", () => {
  const contextIndex = productCapabilitySource.indexOf("context.productTemplateId");
  const searchIndex = productCapabilitySource.indexOf("extractSearchTerm(message)");
  assert.ok(contextIndex >= 0 && searchIndex >= 0 && contextIndex < searchIndex);
});

test("product search result is bounded to a small maximum", () => {
  assert.match(productCapabilitySource, /const MAX_RESULTS = 5;/);
  assert.ok(productCapabilitySource.includes(".limit(MAX_RESULTS)"));
});

// E. Quotation ---------------------------------------------------------------

test("quotation capability checks context.quotationId before searching by text", () => {
  const contextIndex = quotationCapabilitySource.indexOf("context.quotationId");
  const identifierIndex = quotationCapabilitySource.indexOf("extractQuotationIdentifier(message)");
  assert.ok(contextIndex >= 0 && identifierIndex >= 0 && contextIndex < identifierIndex);
});

test("quotation answer is built only from *_snapshot columns, never a live product_templates refetch", () => {
  assert.ok(quotationCapabilitySource.includes("item_name_snapshot"));
  assert.ok(quotationCapabilitySource.includes("item_code_snapshot"));
  assert.ok(quotationCapabilitySource.includes("model_snapshot"));
  assert.ok(!quotationCapabilitySource.includes('.from("product_templates")'));
});

test("a missing/unmatched quotation produces a safe not-found/ambiguous response, not an error", () => {
  // Phase 1C (PART 9): a stale/inaccessible context.quotationId now returns deterministic
  // not-found directly, rather than falling back to a text search - see
  // lib/noa/noa-phase-1c-safety.test.mts for the dedicated Phase 1C coverage of this.
  assert.match(quotationCapabilitySource, /reason: "not_found"/);
  assert.match(quotationCapabilitySource, /reason: "ambiguous"/);
  assert.ok(quotationCapabilitySource.includes("I couldn't find that quotation."));
});

// F. Price ---------------------------------------------------------------

test("price capability reuses productTemplatePriceCheckState instead of recomputing status", () => {
  assert.ok(priceCapabilitySource.includes('from "@/lib/product-price-check"'));
  assert.ok(priceCapabilitySource.includes("productTemplatePriceCheckState("));
});

test("price capability does not duplicate the price-check date/interval formula", () => {
  assert.ok(!/dueAt|intervalDays \* dayMs|price_check_interval_days > 0/.test(priceCapabilitySource));
});

test("price capability explains the live-vs-snapshot distinction instead of reinterpreting a quotation price as live", () => {
  assert.ok(priceCapabilitySource.includes("context.quotationId && !context.productTemplateId"));
  assert.ok(priceCapabilitySource.includes("fixed snapshot"));
});

// G. API ---------------------------------------------------------------

test("route rejects unauthenticated requests with 401 before touching the orchestrator", () => {
  assert.match(routeSource, /if \(!user\) \{\s*return errorResponse\("You need to be signed in to use NOA\.", 401\);/);
});

test("route rejects empty/invalid request bodies with 400", () => {
  assert.match(routeSource, /if \(!message\) \{\s*return errorResponse\("A message is required\.", 400\);/);
  assert.ok(routeSource.includes('return errorResponse("Invalid request.", 400);'));
});

test("a successful request returns the orchestrator's NoaAnswer shape (domain, text, sources) as JSON", () => {
  assert.ok(routeSource.includes("const answer = await runNoaOrchestrator(chatRequest);"));
  assert.ok(routeSource.includes("return NextResponse.json(answer);"));
  assert.ok(orchestratorSource.includes("Promise<NoaAnswer>"));
});

test("route never exposes raw errors/stack traces", () => {
  assert.ok(!/error\.message/.test(routeSource.replace(/logServerActionError[\s\S]*?\);/, "")));
  assert.ok(!routeSource.includes("error.stack"));
});

// H. UI wiring ---------------------------------------------------------------

test("the Phase 1A mock response text is removed", () => {
  assert.ok(!assistantSource.includes("NOA is ready. ProjectWorkflow data access will be connected in the next phase."));
});

test("NoaAssistant posts to /api/noa/chat", () => {
  assert.ok(assistantSource.includes('const NOA_CHAT_ENDPOINT = "/api/noa/chat";'));
  assert.ok(assistantSource.includes("fetch(NOA_CHAT_ENDPOINT"));
});

test("only a small bounded recent-message history is sent, not the full session", () => {
  assert.match(assistantSource, /const RECENT_MESSAGE_LIMIT = 6;/);
  assert.ok(assistantSource.includes(".slice(-RECENT_MESSAGE_LIMIT)"));
});

test("thinking -> success/error state transitions are preserved around the real request", () => {
  assert.ok(assistantSource.includes('dispatch({ type: "SEND" })'));
  assert.ok(assistantSource.includes('dispatch({ type: "RESPONSE_SUCCESS" })'));
  assert.ok(assistantSource.includes('dispatch({ type: "RESPONSE_ERROR" })'));
});
