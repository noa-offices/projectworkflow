import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-orchestrator.ts has "server-only" + "@/..." aliases, neither resolvable by Node's plain ESM
// resolver outside the Next.js build. Source-level wiring/safety checks, same convention as every
// other lib/noa/*-safety.test.mts file. noa-project-capability.server.ts is read here to confirm
// only its text-classification surface (isDetailQuestion/projectTarget) changed - not auth/query.

const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const projectCapabilitySource = readFileSync("lib/noa/noa-project-capability.server.ts", "utf8");
const conversationReferenceSource = readFileSync("lib/noa/noa-conversation-reference.ts", "utf8");

// ── Project semantic wiring / target recognition (tests 1-5) ───────────────────

test("projectTarget recognizes the C4B natural phrasings without touching the query/select/auth logic", () => {
  // ERP-NOA-1 widened these two literal patterns to also optionally consume "record(s) " (so the
  // same pattern serves both the default ERP path and the explicit "project record X" path) -
  // that phase's own safety test covers the exact new literal; this older C4B check only confirms
  // the underlying phrase recognition ("tell me about"/"what status is") still exists at all.
  assert.ok(projectCapabilitySource.includes("tell me about (?:project"));
  assert.ok(projectCapabilitySource.includes("what status is (?:project"));
  assert.ok(projectCapabilitySource.includes("PROJECT_SELECT = \"id,client_id,project_name,project_number,project_code,location,consultant,contractor,project_status,is_active,created_at\";"));
});

test("isDetailQuestion recognizes 'tell me about' / 'status is' alongside the existing phrase set", () => {
  assert.match(
    projectCapabilitySource,
    /\/\\b\(project details\?\|project status\|status of project\|client is project\|where is project\|tell me about\|status is\)\\b\/i/,
  );
});

test("a confident Project-domain classification reroutes an otherwise-unresolved Help message - no intent gate, matching the C4A Quotation shape", () => {
  assert.match(orchestratorSource, /if \(!semanticRequest && extracted\.domain === "Project"\) \{\s*\n\s*semanticRequest = \{ domain: "Project", intent: extracted\.intent \};/);
});

test("the Project reroute only ever fires for the Help/unresolved fallback path", () => {
  const triggerIndex = orchestratorSource.indexOf('if (!recordedQuotationFollowUpFrom && (route === "UserActivity" || route === "Help"))');
  const projectCheckIndex = orchestratorSource.indexOf('extracted.domain === "Project"');
  assert.ok(triggerIndex >= 0 && projectCheckIndex >= 0 && triggerIndex < projectCheckIndex);
});

// ── Follow-up behavior (tests 6-8) ──────────────────────────────────────────────

// ERP-NOA-2 renamed the end-of-function marker comment (now "C4B/ERP-NOA-2: builds a bounded
// Project conversationReference...") when it extended resolveProjectFollowUp to also recognize a
// "project_file" entity type - these two slice boundaries are updated to match.
test("resolveProjectFollowUp only fires against a Project-domain conversationReference carrying a project label", () => {
  const fnStart = orchestratorSource.indexOf("function resolveProjectFollowUp");
  const fnEnd = orchestratorSource.indexOf("\n// C4B/ERP-NOA-2: builds a bounded Project conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('if (reference.domain !== "Project") return undefined;'));
  assert.ok(fnBody.includes('entity.type === "project"'));
});

test("a pronoun follow-up rewrites the message with the inherited project label, then re-dispatches through the unchanged capability - never answering from stale data directly", () => {
  const fnStart = orchestratorSource.indexOf("function resolveProjectFollowUp");
  const fnEnd = orchestratorSource.indexOf("\n// C4B/ERP-NOA-2: builds a bounded Project conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("rewrittenMessage"));
  assert.ok(!/\bstatus\b|\bclient\b/i.test(fnBody.replace(/\/\/.*$/gm, "")), "resolver must not reference/reuse status or client facts");
});

test("the Project capability is always dispatched with the rewritten-or-original message, never a cached result", () => {
  assert.match(orchestratorSource, /: domain === "Project"\s*\n\s*\? await fetchNoaProjectCapability\(projectMessageOverride \?\? request\.message, request\.context\)/);
});

// ── Reference building (bounded, safe, no UUIDs) ────────────────────────────────

test("buildProjectConversationReference reads only projectName fields - never an id/UUID/client id", () => {
  const fnStart = orchestratorSource.indexOf("function buildProjectConversationReference");
  const fnEnd = orchestratorSource.indexOf("\n// C4A: builds a bounded Quotation conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("project.projectName") || fnBody.includes(".projectName"));
  assert.ok(!/\brecord\.id\b|clientId|client_id|\.uuid\b/.test(fnBody));
});

test("the Project reference is capped via the same shared MAX_CONVERSATION_REFERENCE_ENTITIES bound", () => {
  const fnStart = orchestratorSource.indexOf("function buildProjectConversationReference");
  const fnEnd = orchestratorSource.indexOf("\n// C4A: builds a bounded Quotation conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("boundConversationReferenceEntities("));
});

test("no new fields were added to NoaConversationReference for Project - it reuses the existing bounded shape as-is", () => {
  assert.ok(!conversationReferenceSource.includes("projectId"));
  assert.ok(!conversationReferenceSource.includes("clientId"));
});

// ── Regression (tests 9-13) ─────────────────────────────────────────────────────

test("regression: UserActivity reference/domain checks and the Quotation domain check still run strictly before the new Project checks", () => {
  const userActivityRefIndex = orchestratorSource.indexOf('if (conversationReference?.domain === "UserActivity")');
  const quotationDomainIndex = orchestratorSource.indexOf('if (!semanticRequest && extracted.domain === "Quotation")');
  const projectRefIndex = orchestratorSource.indexOf('if (!semanticRequest && conversationReference?.domain === "Project")');
  const projectDomainIndex = orchestratorSource.indexOf('if (!semanticRequest && extracted.domain === "Project")');
  assert.ok(userActivityRefIndex >= 0 && quotationDomainIndex >= 0 && projectRefIndex >= 0 && projectDomainIndex >= 0);
  assert.ok(userActivityRefIndex < quotationDomainIndex);
  assert.ok(quotationDomainIndex < projectRefIndex);
  assert.ok(projectRefIndex < projectDomainIndex);
});

test("regression: Quotation dispatch is untouched, so 'quotations for project ABC' / 'quotation total for project ABC' keep resolving via the existing deterministic Quotation route", () => {
  assert.match(orchestratorSource, /: domain === "Quotation"\s*\n\s*\? await fetchNoaQuotationCapability\(request\.message, request\.context\)/);
});

test("regression: Product/Price/Client/Procurement/Admin/Insights/UserActivity dispatch branches are untouched", () => {
  // fetchNoaClientCapability/fetchNoaProcurementCapability's message arguments were intentionally
  // widened by C4C, and fetchNoaProductCapability/fetchNoaPriceCapability's by C4D (each
  // `<override> ?? request.message`); each phase's own safety test covers its exact call shape,
  // so this older C4B regression check only pins that the branches themselves still exist.
  assert.ok(orchestratorSource.includes("await fetchNoaClientCapability("));
  assert.ok(orchestratorSource.includes("await fetchNoaProcurementCapability("));
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

// ── Security preservation (test 14) ─────────────────────────────────────────────

test("Project authorization is untouched: requireActiveUser() remains the single auth gate, unconditional and independent of semantic/reference input", () => {
  assert.ok(projectCapabilitySource.includes("await requireActiveUser();"));
  assert.ok(!projectCapabilitySource.includes("semantic"));
  assert.ok(!projectCapabilitySource.includes("conversationReference"));
});

test("a resolved semantic request never authorizes anything - buildProjectConversationReference and resolveProjectFollowUp never reference the Project auth gate", () => {
  assert.ok(!/requireActiveUser/.test(orchestratorSource));
});

// ── No UUID/internal id exposure (test 15) ──────────────────────────────────────

test("no project/client UUID ever appears in a conversationReference entity - only the safe projectName label", () => {
  const fnStart = orchestratorSource.indexOf("function buildProjectConversationReference");
  // C4C inserted the Client/Procurement follow-up/reference functions directly after this one, so
  // the end anchor is narrowed to this function's own closing brace instead of sweeping into that
  // unrelated new code (whose own explanatory comments mention "client.id" in prose, a harmless
  // false positive for this narrow .id-literal check).
  const fnEnd = orchestratorSource.indexOf("\n// C4C: resolves a Client follow-up", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(!/\.id\b/.test(fnBody.replace(/entities\.map/g, "")));
});

// ── Cost/token control (test 16) ────────────────────────────────────────────────

test("still exactly one extractor invocation per request after C4B", () => {
  const count = (orchestratorSource.match(/extractNoaSemanticRequest\(/g) ?? []).length;
  assert.equal(count, 1);
});

test("no recentMessages/capabilityData/Project rows sent to the extractor for the Project path either", () => {
  const callMatch = orchestratorSource.match(/extractNoaSemanticRequest\(([^)]*)\)/);
  assert.ok(callMatch);
  assert.match(callMatch[1], /^\{ context: request\.context, message: request\.message \}$/);
});

test("no mutation calls or cross-capability chaining were introduced", () => {
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;
  assert.ok(!mutationPattern.test(orchestratorSource.slice(orchestratorSource.indexOf("function resolveProjectFollowUp"))));
});
