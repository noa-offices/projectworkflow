import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-orchestrator.ts has "server-only" + "@/..." aliases, neither resolvable by Node's plain ESM
// resolver outside the Next.js build. Source-level wiring/safety checks, same convention as every
// other lib/noa/*-safety.test.mts file. noa-procurement-capability.server.ts is read here only to
// confirm C4C did NOT need to touch it (it already re-derives everything from raw message text
// via its own bare order-token fallback, mirroring C4A's Quotation finding).

const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const clientCapabilitySource = readFileSync("lib/noa/noa-client-capability.server.ts", "utf8");
const procurementCapabilitySource = readFileSync("lib/noa/noa-procurement-capability.server.ts", "utf8");
const conversationReferenceSource = readFileSync("lib/noa/noa-conversation-reference.ts", "utf8");

// ── Client semantic wiring (tests 1-2) ──────────────────────────────────────────

test("clientQuestionKind/clientTarget recognize the C4C natural phrasings without touching the query/select/auth logic", () => {
  assert.ok(clientCapabilitySource.includes("/(?:tell me about|show) client (.+)$/i"));
  assert.ok(clientCapabilitySource.includes("/projects? (?:do|does) (?:client )?(.+?) have\\b/i"));
  assert.ok(clientCapabilitySource.includes('const CLIENT_SELECT = "id,company_name,client_number,client_code,is_active";'));
});

test("a confident Client-domain classification reroutes an otherwise-unresolved Help message - no intent gate, matching the C4A/C4B shape", () => {
  assert.match(orchestratorSource, /if \(!semanticRequest && extracted\.domain === "Client"\) \{\s*\n\s*semanticRequest = \{ domain: "Client", intent: extracted\.intent \};/);
});

test("the Client reroute only ever fires for the Help/unresolved fallback path", () => {
  const triggerIndex = orchestratorSource.indexOf('if (!recordedQuotationFollowUpFrom && (route === "UserActivity" || route === "Help"))');
  const clientCheckIndex = orchestratorSource.indexOf('extracted.domain === "Client"');
  assert.ok(triggerIndex >= 0 && clientCheckIndex >= 0 && triggerIndex < clientCheckIndex);
});

// ── Client follow-up / reference (tests 3-4) ────────────────────────────────────

test("resolveClientFollowUp only fires against a Client-domain conversationReference carrying a client label", () => {
  const fnStart = orchestratorSource.indexOf("function resolveClientFollowUp");
  const fnEnd = orchestratorSource.indexOf("\n// C4C: builds a bounded Client conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('if (reference.domain !== "Client") return undefined;'));
  assert.ok(fnBody.includes('entity.type === "client"'));
});

test("a Client follow-up rewrites the message (pronoun substitution or bare-question append) and always re-dispatches through the unchanged capability", () => {
  assert.match(orchestratorSource, /: domain === "Client"\s*\n\s*\? await fetchNoaClientCapability\(clientMessageOverride \?\? request\.message, request\.context\)/);
});

test("buildClientConversationReference reads only the safe display name - never client.id/UUID", () => {
  const fnStart = orchestratorSource.indexOf("function buildClientConversationReference");
  const fnEnd = orchestratorSource.indexOf("\n// C4C: resolves a Procurement follow-up", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("client.name") || fnBody.includes(".name"));
  assert.ok(!/\.id\b/.test(fnBody.replace(/entities\.map/g, "")));
  assert.ok(fnBody.includes("boundConversationReferenceEntities("));
});

test("Client business logic query/select/auth fields are unchanged - only text-classification helpers were touched", () => {
  assert.ok(clientCapabilitySource.includes("await requireActiveUser();"));
  assert.ok(!clientCapabilitySource.includes("semanticRequest"));
  assert.ok(!clientCapabilitySource.includes("conversationReference"));
});

// ── Procurement semantic wiring (tests 6-7) ─────────────────────────────────────

test("Procurement capability was not touched - it already re-derives detail/list/target from raw message text via its own bare order-token fallback (mirrors C4A's Quotation finding)", () => {
  assert.ok(procurementCapabilitySource.includes("export async function fetchNoaProcurementCapability("));
  assert.ok(!procurementCapabilitySource.includes("semanticRequest"));
  assert.ok(!procurementCapabilitySource.includes("conversationReference"));
});

test("a confident Procurement-domain classification reroutes an otherwise-unresolved Help message - no intent gate", () => {
  assert.match(orchestratorSource, /if \(!semanticRequest && extracted\.domain === "Procurement"\) \{\s*\n\s*semanticRequest = \{ domain: "Procurement", intent: extracted\.intent \};/);
});

test("the Procurement reroute only ever fires for the Help/unresolved fallback path", () => {
  const triggerIndex = orchestratorSource.indexOf('if (!recordedQuotationFollowUpFrom && (route === "UserActivity" || route === "Help"))');
  const procurementCheckIndex = orchestratorSource.indexOf('extracted.domain === "Procurement"');
  assert.ok(triggerIndex >= 0 && procurementCheckIndex >= 0 && triggerIndex < procurementCheckIndex);
});

// ── Procurement follow-up / reference (tests 8-10) ──────────────────────────────

test("resolveProcurementFollowUp only fires against a Procurement-domain conversationReference carrying an order label, and skips when the message already names its own order token", () => {
  const fnStart = orchestratorSource.indexOf("function resolveProcurementFollowUp");
  const fnEnd = orchestratorSource.indexOf("\n// C4C: builds a bounded Procurement conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('if (reference.domain !== "Procurement") return undefined;'));
  assert.ok(fnBody.includes("PROCUREMENT_ORDER_TOKEN_PATTERN.test(message)"));
});

test("a Procurement follow-up rewrites the message by appending the inherited order label, and always re-dispatches through the unchanged capability", () => {
  assert.match(orchestratorSource, /: domain === "Procurement"\s*\n\s*\? await fetchNoaProcurementCapability\(procurementMessageOverride \?\? request\.message, request\.context\)/);
});

test("buildProcurementConversationReference reads only orderNo/vendorLabel - never vendor_key, quotation id, storage path, or a signed URL", () => {
  const fnStart = orchestratorSource.indexOf("function buildProcurementConversationReference");
  const fnEnd = orchestratorSource.indexOf("\n// C4A: builds a bounded Quotation conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes(".orderNo"));
  assert.ok(fnBody.includes("vendorLabel"));
  assert.ok(!/vendor_key|dedupeKey|quotationId|signedUrl|storagePath|\.id\b/.test(fnBody.replace(/entities:/g, "")));
  assert.ok(fnBody.includes("boundConversationReferenceEntities("));
});

// ── Reference type unchanged ─────────────────────────────────────────────────────

test("no new fields were added to NoaConversationReference for Client/Procurement - the existing bounded shape is reused as-is", () => {
  assert.ok(!conversationReferenceSource.includes("clientId"));
  assert.ok(!conversationReferenceSource.includes("orderId"));
  assert.ok(!conversationReferenceSource.includes("vendorKey"));
});

// ── Regression (tests 14-18) ─────────────────────────────────────────────────────

test("regression: UserActivity/Quotation/Project reference checks and domain checks all still run strictly before the new Client/Procurement checks", () => {
  const userActivityRefIndex = orchestratorSource.indexOf('if (conversationReference?.domain === "UserActivity")');
  const quotationDomainIndex = orchestratorSource.indexOf('if (!semanticRequest && extracted.domain === "Quotation")');
  const projectRefIndex = orchestratorSource.indexOf('if (!semanticRequest && conversationReference?.domain === "Project")');
  const projectDomainIndex = orchestratorSource.indexOf('if (!semanticRequest && extracted.domain === "Project")');
  const clientRefIndex = orchestratorSource.indexOf('if (!semanticRequest && conversationReference?.domain === "Client")');
  const clientDomainIndex = orchestratorSource.indexOf('if (!semanticRequest && extracted.domain === "Client")');
  const procurementRefIndex = orchestratorSource.indexOf('if (!semanticRequest && conversationReference?.domain === "Procurement")');
  const procurementDomainIndex = orchestratorSource.indexOf('if (!semanticRequest && extracted.domain === "Procurement")');
  assert.ok([userActivityRefIndex, quotationDomainIndex, projectRefIndex, projectDomainIndex, clientRefIndex, clientDomainIndex, procurementRefIndex, procurementDomainIndex].every((i) => i >= 0));
  assert.ok(userActivityRefIndex < quotationDomainIndex);
  assert.ok(quotationDomainIndex < projectRefIndex);
  assert.ok(projectRefIndex < projectDomainIndex);
  assert.ok(projectDomainIndex < clientRefIndex);
  assert.ok(clientRefIndex < clientDomainIndex);
  assert.ok(clientDomainIndex < procurementRefIndex);
  assert.ok(procurementRefIndex < procurementDomainIndex);
});

test("regression: Quotation/Project/UserActivity dispatch branches are untouched", () => {
  assert.match(orchestratorSource, /: domain === "Quotation"\s*\n\s*\? await fetchNoaQuotationCapability\(request\.message, request\.context\)/);
  assert.match(orchestratorSource, /: domain === "Project"\s*\n\s*\? await fetchNoaProjectCapability\(projectMessageOverride \?\? request\.message, request\.context\)/);
  assert.ok(orchestratorSource.includes("await fetchNoaUserActivityCapability(request.message, request.context, {"));
});

test("regression: Product/Price/Admin/Insights dispatch branches are untouched", () => {
  // fetchNoaProductCapability/fetchNoaPriceCapability's message arguments were intentionally
  // widened by C4D (productMessageOverride ?? request.message); C4D's own safety test covers
  // those exact call shapes, so this older C4C regression check only pins that the branches
  // themselves still exist.
  assert.ok(orchestratorSource.includes("await fetchNoaProductCapability("));
  assert.ok(orchestratorSource.includes("await fetchNoaPriceCapability("));
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

// ── Security preservation (tests 11-13) ─────────────────────────────────────────

test("Client authorization is untouched: requireActiveUser() remains the single auth gate", () => {
  assert.ok(clientCapabilitySource.includes("await requireActiveUser();"));
});

test("Procurement authorization is untouched: requireProcurementManager() remains the single auth gate", () => {
  assert.ok(procurementCapabilitySource.includes("await requireProcurementManager();"));
});

test("no semantic/reference logic ever calls an auth gate - authorization only happens inside each capability's own dispatch", () => {
  const beforeDispatch = orchestratorSource.slice(0, orchestratorSource.indexOf("export async function runNoaOrchestrator"));
  assert.ok(!/requireActiveUser|requireProcurementManager/.test(beforeDispatch));
});

// ── Cost/token control (test 19) ────────────────────────────────────────────────

test("still exactly one extractor invocation per request after C4C", () => {
  const count = (orchestratorSource.match(/extractNoaSemanticRequest\(/g) ?? []).length;
  assert.equal(count, 1);
});

test("no recentMessages/capabilityData/client-or-procurement rows sent to the extractor", () => {
  const callMatch = orchestratorSource.match(/extractNoaSemanticRequest\(([^)]*)\)/);
  assert.ok(callMatch);
  assert.match(callMatch[1], /^\{ context: request\.context, message: request\.message \}$/);
});

test("no mutation calls or cross-capability chaining were introduced", () => {
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;
  assert.ok(!mutationPattern.test(orchestratorSource.slice(orchestratorSource.indexOf("function resolveClientFollowUp"))));
});
