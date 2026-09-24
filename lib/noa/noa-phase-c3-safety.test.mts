import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  boundConversationReferenceEntities,
  isNoaConversationReference,
  MAX_CONVERSATION_REFERENCE_ENTITIES,
} from "./noa-conversation-reference.js";

// noa-orchestrator.ts, noa-user-activity-capability.server.ts, and app/api/noa/chat/route.ts (via
// its own dedicated content string) all have "server-only"/"use client" + "@/..." aliases, none
// resolvable by Node's plain ESM resolver outside the Next.js build. Source-level wiring/safety
// checks for those, same convention as every other lib/noa/*-safety.test.mts file.
// noa-conversation-reference.ts itself is pure/alias-free and imported + executed directly above.

const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const activitySource = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
const routeSource = readFileSync("app/api/noa/chat/route.ts", "utf8");
const assistantSource = readFileSync("components/noa/noa-assistant.tsx", "utf8");
const typesSource = readFileSync("lib/noa/noa-types.ts", "utf8");

// ── Part 1: conversation reference type / validation (pure, executable) ────────

test("isNoaConversationReference accepts a minimal valid reference and the PART 2 example shape", () => {
  assert.ok(isNoaConversationReference({ domain: "UserActivity", intent: "activity_time" }));
  assert.ok(isNoaConversationReference({
    domain: "UserActivity",
    entities: [{ label: "QN-0005-001", type: "quotation" }],
    intent: "recorded_activity",
    period: "today",
    subject: { type: "self" },
  }));
});

test("isNoaConversationReference rejects an unknown domain, malformed subject, or oversized/malformed entities", () => {
  assert.ok(!isNoaConversationReference({ domain: "NotARealDomain", intent: "activity_time" }));
  assert.ok(!isNoaConversationReference({ domain: "UserActivity", intent: "activity_time", subject: { type: "named_user" } }));
  assert.ok(!isNoaConversationReference({
    domain: "UserActivity",
    entities: Array.from({ length: 6 }, (_, i) => ({ label: `Q-${i}`, type: "quotation" })),
    intent: "recorded_activity",
  }));
  assert.ok(!isNoaConversationReference({ domain: "UserActivity", entities: [{ type: "quotation", label: 42 }], intent: "recorded_activity" }));
  assert.ok(!isNoaConversationReference(null));
  assert.ok(!isNoaConversationReference("UserActivity"));
});

test("isNoaConversationReference never requires or accepts a raw id/email as a distinguishing field", () => {
  // The type permits an optional opaque `id` for a future entity kind, but no current producer
  // (see PART 5/6 assertions below) ever sets one - this test only proves the validator doesn't
  // require it, i.e. label-only entities are already fully valid.
  assert.ok(isNoaConversationReference({ domain: "UserActivity", entities: [{ label: "QN-1", type: "quotation" }], intent: "recorded_activity" }));
});

test("boundConversationReferenceEntities hard-caps at MAX_CONVERSATION_REFERENCE_ENTITIES regardless of input size", () => {
  assert.equal(MAX_CONVERSATION_REFERENCE_ENTITIES, 5);
  const oversized = Array.from({ length: 12 }, (_, i) => ({ label: `Q-${i}`, type: "quotation" }));
  assert.equal(boundConversationReferenceEntities(oversized).length, 5);
});

// ── Part 4: request/answer contract ─────────────────────────────────────────────

test("NoaChatRequest and NoaAnswer both carry an optional conversationReference - additive, backward compatible", () => {
  assert.match(typesSource, /conversationReference\?: NoaConversationReference;/);
  const occurrences = (typesSource.match(/conversationReference\?: NoaConversationReference;/g) ?? []).length;
  assert.equal(occurrences, 2, "expected one optional field on NoaChatRequest and one on NoaAnswer");
});

// ── Part 3/2 - reference source and transport ───────────────────────────────────

test("the incoming conversationReference is validated (never blindly trusted) both at the route boundary and again in the orchestrator", () => {
  assert.ok(routeSource.includes("isNoaConversationReference(rawConversationReference)"));
  assert.ok(orchestratorSource.includes("isNoaConversationReference(request.conversationReference)"));
});

test("the reference is built ONLY from this result's own capabilityData - never from recentMessages, provider text, or prose", () => {
  const fnStart = orchestratorSource.indexOf("function buildUserActivityConversationReference");
  // GPC-3 renamed the exported dispatch function to runNoaOrchestratorCore and added a thin
  // runNoaOrchestrator wrapper at the very end of the file (which legitimately still matches the
  // literal "export async function runNoaOrchestrator" text this end-anchor originally looked
  // for) - narrowed to the next section marker instead, so the slice stays scoped to just this
  // one builder function, exactly as originally intended.
  const fnBody = orchestratorSource.slice(fnStart, orchestratorSource.indexOf("\n// C4B:", fnStart));
  assert.ok(!fnBody.includes("recentMessages"));
  assert.ok(!fnBody.includes("request.message"));
  assert.ok(fnBody.includes("data: unknown"));
});

test("the summary capability path computes quotation identifiers from rows it already fetched - no extra query", () => {
  const fnStart = activitySource.indexOf("async function summaryAnswer");
  const fnBody = activitySource.slice(fnStart, activitySource.indexOf("\n// PART 6:", fnStart));
  assert.ok(fnBody.includes("quotationIdentifierFromAuditTitle"));
  assert.ok(fnBody.includes("quotationIdentifiers"));
  const queryCount = (fnBody.match(/\.from\("/g) ?? []).length;
  assert.equal(queryCount, 0, "expected summaryAnswer to reuse auditLogRowsForUser's rows, not run a second Supabase query");
});

test("the client component round-trips the reference: sends it on every request, replaces (never merges) it after success, and leaves it untouched on failure", () => {
  assert.ok(assistantSource.includes("conversationReferenceRef.current"));
  // GPC-3 added a second, independent productConfigurationReference field to the same request
  // body (see the dedicated GPC-3 safety test for that addition) - the literal grew accordingly.
  assert.match(assistantSource, /body: JSON\.stringify\(\{ context, conversationReference, message, productConfigurationReference, recentMessages \}\)/);
  assert.ok(assistantSource.includes("conversationReferenceRef.current = answer.conversationReference;"));
  const catchIndex = assistantSource.indexOf(".catch((error: unknown) => {");
  const catchBlock = assistantSource.slice(catchIndex, assistantSource.indexOf(".finally(", catchIndex));
  assert.ok(!catchBlock.includes("conversationReferenceRef.current ="));
});

test("no server-side persistence was introduced for the conversation reference (no table/cookie/cache write)", () => {
  for (const source of [orchestratorSource, activitySource, routeSource]) {
    assert.ok(!/\.from\("conversation|\.from\("noa_conversation|cookies\(\)\.set|localStorage|sessionStorage/i.test(source));
  }
});

// ── Part 6/8 - quotation follow-up behavior ─────────────────────────────────────

test("a quotation follow-up is resolved entirely from conversationReference.entities - never a fresh/generic quotation query", () => {
  const kindStart = activitySource.indexOf('if (kind === "quotation_follow_up") {');
  const kindBody = activitySource.slice(kindStart, activitySource.indexOf('if (kind === "presence_boundary")', kindStart));
  assert.ok(kindBody.includes("options.conversationReference?.entities"));
  assert.ok(!kindBody.includes(".from("));
});

test("quotation_follow_up still requires requireActiveUser() - the reference alone never grants access", () => {
  const kindStart = activitySource.indexOf('if (kind === "quotation_follow_up") {');
  const kindBody = activitySource.slice(kindStart, kindStart + 300);
  assert.ok(kindBody.includes("await requireActiveUser();"));
});

test("one quotation -> answers that one; multiple -> bounded list; none -> honest no-identifier message, never a generic quotation list", () => {
  assert.ok(activitySource.includes("The quotation was ${labels[0]}."));
  assert.ok(activitySource.includes("The quotations were ${labels.join(\", \")}."));
  assert.ok(activitySource.includes("I found recorded quotation activity, but no safe quotation identifier is available from that activity record."));
});

test("the quotation follow-up entity list is capped at MAX_CONVERSATION_REFERENCE_ENTITIES", () => {
  assert.ok(activitySource.includes(".slice(0, MAX_CONVERSATION_REFERENCE_ENTITIES)"));
});

// ── Part 9 - mandatory generic-quotation regression ─────────────────────────────

test("the UserActivity follow-up path only ever activates for a conversationReference whose domain is UserActivity - never any other domain's reference", () => {
  assert.match(orchestratorSource, /if \(conversationReference\?\.domain === "UserActivity"\) \{\s*\n\s*semanticRequest = resolveUserActivityFollowUp/);
});

test("resolveUserActivityFollowUp itself only recognizes recorded_activity (quotation) and activity_time (period/subject) reference intents - nothing else", () => {
  const fnStart = orchestratorSource.indexOf("function resolveUserActivityFollowUp");
  const fnBody = orchestratorSource.slice(fnStart, orchestratorSource.indexOf("\n// C3: builds the fresh conversationReference", fnStart));
  assert.ok(fnBody.includes('reference.intent === "recorded_activity"'));
  assert.ok(fnBody.includes('reference.intent === "activity_time"'));
  assert.ok(!fnBody.includes('reference.intent === "Quotation"'));
});

// ── Part 7/11 - safety: no stale facts, no inherited authorization ─────────────

test("the activity_time period/subject follow-up always re-executes the real capability path - it never returns a stale duration from the reference", () => {
  const fnStart = orchestratorSource.indexOf("function resolveUserActivityFollowUp");
  const fnBody = orchestratorSource.slice(fnStart, orchestratorSource.indexOf("\n// C3: builds the fresh conversationReference", fnStart));
  assert.ok(!fnBody.includes("deterministicText"));
  assert.ok(!fnBody.includes("activeMinutes"));
});

test("no auth helper is called or bypassed inside the pure follow-up resolver - authorization still only happens in the capability", () => {
  const fnStart = orchestratorSource.indexOf("function resolveUserActivityFollowUp");
  const fnBody = orchestratorSource.slice(fnStart, orchestratorSource.indexOf("\n// C3: builds the fresh conversationReference", fnStart));
  assert.ok(!/requireActiveUser|requireSystemOwner|requireSettingsManager/.test(fnBody));
});

test("named-user activity-time follow-ups still require requireSystemOwner() via the existing activity_time_other dispatch - never inherited from the reference", () => {
  // resolveUserActivityFollowUp only ever maps a named_user-subject continuation to the existing
  // "activity_time" intent (see the test above), which flows through the unchanged
  // semanticActivityOverride -> activity_time_other -> requireSystemOwner() path already verified
  // in noa-phase-c2-safety.test.mts - this test just confirms that dispatch code is still present
  // and untouched.
  assert.ok(activitySource.includes('if (subject?.type === "named_user" && subject.name.trim()) return { kind: "activity_time_other", targetName: subject.name.trim() };'));
  const gateIndex = activitySource.indexOf('if (kind === "activity_time_team_recent" || isActivityTimeOther) {');
  assert.ok(activitySource.slice(gateIndex, gateIndex + 200).includes("await requireSystemOwner();"));
});

// ── Part 12 - provider never receives the reference as a fact source ───────────

test("conversationReference is never sent into the provider payload - capabilityData remains the only business-fact source", () => {
  const providerCallStart = orchestratorSource.indexOf("await runNoaProvider({");
  const providerCallBody = orchestratorSource.slice(providerCallStart, orchestratorSource.indexOf("});", providerCallStart));
  assert.ok(!providerCallBody.includes("conversationReference"));
});

// ── Part 13 - cost control: still at most one extractor call, no new payload growth ─

test("still exactly one extractor invocation per request, and conversationReference is never passed to it", () => {
  const count = (orchestratorSource.match(/extractNoaSemanticRequest\(/g) ?? []).length;
  assert.equal(count, 1);
  const callMatch = orchestratorSource.match(/extractNoaSemanticRequest\(([^)]*)\)/);
  assert.ok(callMatch);
  assert.ok(!callMatch[1].includes("conversationReference"));
});

// ── Part 10 - one reference only, replaced not accumulated ─────────────────────

test("only a single conversationReference field exists on the answer/request contracts - no array, no history list", () => {
  assert.ok(!typesSource.includes("conversationReferences"));
  assert.ok(!orchestratorSource.includes("conversationReferences"));
  assert.ok(!assistantSource.includes("conversationReferences"));
});

// ── Regression: greeting/capabilities/other domains unaffected ─────────────────

test("regression: greeting and explicit capabilities routes are unaffected by C3 and still return before any semantic extraction/capability dispatch", () => {
  // A later, external change (predating GPC-3) moved conversationReference PARSING earlier in the
  // function (now alongside route classification) - parsing alone is harmless (it's just
  // isNoaConversationReference(), never a business action), so the safety property this test
  // actually guards - greeting/capabilities never reach the semantic extractor or a capability
  // call - is checked directly instead of via conversationReference's parse position.
  const greetingIndex = orchestratorSource.indexOf('if (route === "greeting")');
  const capabilitiesIndex = orchestratorSource.indexOf('if (route === "capabilities")');
  const extractorCallIndex = orchestratorSource.indexOf("await extractNoaSemanticRequest(");
  assert.ok(greetingIndex >= 0 && capabilitiesIndex >= 0 && extractorCallIndex >= 0);
  assert.ok(greetingIndex < extractorCallIndex && capabilitiesIndex < extractorCallIndex);
});

test("no mutation calls and no cross-capability chaining were introduced", () => {
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;
  for (const source of [orchestratorSource, routeSource]) {
    assert.ok(!mutationPattern.test(source.slice(source.indexOf("conversationReference"))));
  }
  assert.ok(!activitySource.slice(activitySource.indexOf('"quotation_follow_up"')).match(/noa-product-capability|noa-quotation-capability/));
});
