import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-orchestrator.ts has "server-only" + "@/..." aliases, neither resolvable by Node's plain ESM
// resolver outside the Next.js build. Source-level wiring/safety checks, same convention as every
// other lib/noa/*-safety.test.mts file. noa-quotation-capability.server.ts and
// noa-semantic-request.ts are read here only to confirm C4A did NOT need to touch them.

const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const quotationCapabilitySource = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");
const semanticRequestSource = readFileSync("lib/noa/noa-semantic-request.ts", "utf8");
const conversationReferenceSource = readFileSync("lib/noa/noa-conversation-reference.ts", "utf8");

// ── Quotation semantic wiring (tests 1-5: routing, no business-logic change) ───

test("Quotation structured input is additive and keeps the existing auth/query/kind logic", () => {
  // C4A's whole design point: the Quotation capability already re-derives list/count/detail/
  // total/status/comparison/client-relation from raw message text once it receives the message,
  // so semantic wiring only needed to fix ROUTING (getting domain=Quotation for a bare-identifier
  // message with no domain keyword) - never touching quotation business rules.
  assert.ok(quotationCapabilitySource.includes("export async function fetchNoaQuotationCapability("));
  assert.ok(quotationCapabilitySource.includes("message: string,\n  context: NoaPageContext,\n  options: NoaQuotationCapabilityOptions = {},"));
  assert.ok(!quotationCapabilitySource.includes("semanticRequest"));
  assert.ok(!quotationCapabilitySource.includes("conversationReference"));
});

test("no new Quotation semantic intent enum was introduced - C4A reroutes on domain alone, reusing the existing closed intent set", () => {
  assert.ok(!semanticRequestSource.includes("quotation_lookup"));
  assert.ok(!semanticRequestSource.includes("quotation_list"));
  assert.ok(!semanticRequestSource.includes("quotation_detail"));
});

test("a confident Quotation-domain classification reroutes an otherwise-unresolved Help message - no intent gate, since the capability re-derives its own kind from message text", () => {
  const start = orchestratorSource.indexOf('if (!semanticRequest && extracted.domain === "Quotation")');
  const end = orchestratorSource.indexOf("\n    }\n\n    // C4B:", start);
  const block = orchestratorSource.slice(start, end);
  assert.ok(block.includes('semanticRequest = {'));
  assert.ok(block.includes('domain: "Quotation"'));
  assert.ok(block.includes("intent: extracted.intent"));
});

test("the Quotation reroute only ever fires for the Help/unresolved fallback path, never for an already-clear domain (Product/Price/Project/Client/Procurement/Admin/Insights)", () => {
  const triggerIndex = orchestratorSource.indexOf('if (!recordedQuotationFollowUpFrom && (route === "UserActivity" || route === "Help"))');
  const quotationCheckIndex = orchestratorSource.indexOf('extracted.domain === "Quotation"');
  assert.ok(triggerIndex >= 0 && quotationCheckIndex >= 0 && triggerIndex < quotationCheckIndex);
});

test("effectiveRoute generalizes to any semantically-resolved domain, not hardcoded to UserActivity", () => {
  assert.match(orchestratorSource, /const effectiveRoute = route === "Help" && semanticRequest && semanticRequest\.domain !== "Unclear"\s*\n\s*\? semanticRequest\.domain\s*\n\s*: route;/);
});

// ── Reference building (bounded, safe, no UUIDs) ────────────────────────────────

test("buildQuotationConversationReference reads only quotationNo fields - never an id/UUID", () => {
  const fnStart = orchestratorSource.indexOf("function buildQuotationConversationReference");
  const fnBody = orchestratorSource.slice(fnStart, orchestratorSource.indexOf("\n// The one and only dispatch point:", fnStart));
  assert.ok(fnBody.includes("record.quotationNo"));
  assert.ok(fnBody.includes("rows[].quotationNo") || fnBody.includes(".quotationNo"));
  assert.ok(!/\brecord\.id\b|\brow\)\.id\b|clientId|client_id|\.uuid\b/.test(fnBody));
});

test("the Quotation reference is capped via the same shared MAX_CONVERSATION_REFERENCE_ENTITIES bound as UserActivity", () => {
  const fnStart = orchestratorSource.indexOf("function buildQuotationConversationReference");
  const fnBody = orchestratorSource.slice(fnStart, orchestratorSource.indexOf("\n// The one and only dispatch point:", fnStart));
  assert.ok(fnBody.includes("boundConversationReferenceEntities("));
});

test("a Quotation reference is built for every successful Quotation result, not only semantically-routed ones - it never depends on semanticRequest", () => {
  const fnStart = orchestratorSource.indexOf("function buildQuotationConversationReference(data: unknown)");
  assert.ok(fnStart >= 0);
  const signatureLine = orchestratorSource.slice(fnStart, orchestratorSource.indexOf("{", fnStart));
  assert.ok(!signatureLine.includes("semanticRequest"));
});

test("no new fields were added to NoaConversationReference for Quotation - it reuses the existing bounded shape as-is", () => {
  assert.ok(!conversationReferenceSource.includes("clientId"));
  assert.ok(!conversationReferenceSource.includes("quotationId"));
});

// ── Follow-up isolation (test 8: must not steal C3 UserActivity behavior) ──────

test("the UserActivity conversationReference follow-up check still runs strictly before the new Quotation domain check, so a UserActivity-scoped 'which quotation?' is never captured by C4A", () => {
  const userActivityCheckIndex = orchestratorSource.indexOf('if (conversationReference?.domain === "UserActivity")');
  const quotationCheckIndex = orchestratorSource.indexOf('if (!semanticRequest && extracted.domain === "Quotation")');
  assert.ok(userActivityCheckIndex >= 0 && quotationCheckIndex >= 0 && userActivityCheckIndex < quotationCheckIndex);
});

test("the Quotation reroute check never reads conversationReference at all - it can't be influenced by a stale UserActivity reference either way", () => {
  const checkStart = orchestratorSource.indexOf('if (!semanticRequest && extracted.domain === "Quotation")');
  // C4B inserted the (conversationReference-reading) Project follow-up/reroute checks between
  // this block and the "// A resolved semantic request" comment, so the end anchor is narrowed
  // to this block's own closing brace instead of sweeping up the unrelated Project code after it.
  const checkEnd = orchestratorSource.indexOf("\n    }\n\n    // C4B:", checkStart);
  const checkBlock = orchestratorSource.slice(checkStart, checkEnd);
  assert.ok(!checkBlock.includes("conversationReference"));
});

// ── Test 9: malformed/absent reference leaves existing Quotation behavior intact ─

test("Quotation dispatch receives only the optional structured quotation input", () => {
  assert.match(orchestratorSource, /: domain === "Quotation"\s*\n\s*\? await fetchNoaQuotationCapability\(request\.message, request\.context, \{/);
  assert.ok(orchestratorSource.includes("quotation: deterministicQuotation ?? (semanticRequest?.domain === \"Quotation\" ? semanticRequest.quotation : undefined)"));
});

// ── Security preservation ───────────────────────────────────────────────────────

test("Quotation authorization is untouched: requireQuotationActionUser() remains the single auth gate", () => {
  assert.ok(quotationCapabilitySource.includes("await requireQuotationActionUser();"));
  const authIndex = quotationCapabilitySource.indexOf("await requireQuotationActionUser();");
  assert.ok(authIndex >= 0);
});

test("a resolved semantic request never authorizes anything - it is only ever used to select a route/domain, not to bypass a capability's own auth gate", () => {
  const fnStart = orchestratorSource.indexOf("function buildQuotationConversationReference");
  const fnEnd = orchestratorSource.indexOf("\n// The one and only dispatch point:", fnStart);
  const relevantSource = orchestratorSource.slice(0, fnEnd);
  assert.ok(!/requireQuotationActionUser/.test(relevantSource));
});

// ── Cost/token control (tests 12-13) ────────────────────────────────────────────

test("still exactly one extractor invocation per request after C4A", () => {
  const count = (orchestratorSource.match(/extractNoaSemanticRequest\(/g) ?? []).length;
  assert.equal(count, 1);
});

test("no recentMessages/capabilityData sent to the extractor for the Quotation path either - same single tiny call as C2/C3", () => {
  const callMatch = orchestratorSource.match(/extractNoaSemanticRequest\(([^)]*)\)/);
  assert.ok(callMatch);
  assert.match(callMatch[1], /^\{ context: request\.context, message: request\.message \}$/);
});

// ── Regression: no other domain/route logic changed ─────────────────────────────

test("regression: Product/Price/Project/Client/Procurement/Admin/Insights dispatch branches are untouched", () => {
  // fetchNoaProjectCapability/fetchNoaClientCapability/fetchNoaProcurementCapability/
  // fetchNoaProductCapability's message arguments were intentionally widened by C4B/C4C/C4D to
  // `<override> ?? request.message` (pronoun/bare-follow-up rewriting); each phase's own safety
  // test covers its exact call shape, so this older C4A regression check no longer needs to pin
  // their literal args - just that the dispatch branches themselves still exist.
  assert.ok(orchestratorSource.includes('await fetchNoaProjectCapability('));
  assert.ok(orchestratorSource.includes('await fetchNoaClientCapability('));
  assert.ok(orchestratorSource.includes('await fetchNoaProcurementCapability('));
  assert.ok(orchestratorSource.includes('await fetchNoaProductCapability('));
  assert.ok(orchestratorSource.includes('await fetchNoaPriceCapability('));
  for (const fragment of [
    "await fetchNoaAdminCapability(request.message, request.context)",
    "await fetchNoaInsightsCapability(request.message, request.context)",
  ]) {
    assert.ok(orchestratorSource.includes(fragment), fragment);
  }
});

test("regression: greeting/capabilities/context routes still return before any semantic/reference logic runs", () => {
  const greetingIndex = orchestratorSource.indexOf('if (route === "greeting")');
  const capabilitiesIndex = orchestratorSource.indexOf('if (route === "capabilities")');
  const contextIndex = orchestratorSource.indexOf('if (route === "context")');
  const referenceValidationIndex = orchestratorSource.indexOf("isNoaConversationReference(request.conversationReference)");
  assert.ok(contextIndex < referenceValidationIndex && greetingIndex < referenceValidationIndex && capabilitiesIndex < referenceValidationIndex);
});

test("no mutation calls or cross-capability chaining were introduced", () => {
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;
  assert.ok(!mutationPattern.test(orchestratorSource.slice(orchestratorSource.indexOf("buildQuotationConversationReference"))));
});
