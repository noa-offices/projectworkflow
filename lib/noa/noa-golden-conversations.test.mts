// Current architecture baselines: migrate these deliberately with Phase 1/2. Freeze: /AGENTS.md.
// Real orchestrator; fixture reads; disabled semantic runtime. See testing/TEST-MODE.md.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createNoaGoldenSession, installNoaGoldenFixtures } from "./testing/noa-golden-harness";
import { normalizeNoaVoiceTranscript } from "../../components/noa/use-noa-realtime-voice";
installNoaGoldenFixtures(mock);

function fallback(trace: Awaited<ReturnType<ReturnType<typeof createNoaGoldenSession>["send"]>>["trace"]) {
  assert.equal(trace.errorCode, null);
  assert.equal(trace.routeDecision, "Help");
  assert.equal(trace.capabilitySelected, null);
  assert.equal(trace.referenceBindingKind, "not_applicable");
  assert.equal(trace.scopeSource, "generic_query");
  assert.equal(trace.semanticUsed, true); // real V1 extractor invoked, disabled runtime returns Unclear
}

test("CASE A CURRENT BASELINE: social wording falls through to generic Help", async () => {
  const { answer, trace } = await createNoaGoldenSession().send("Hello NOA, how are you today?");
  assert.ok(answer);
  fallback(trace); // future social pre-route must invalidate this baseline
});

test("CASE B CURRENT BASELINE: daily clarification loses continuity on Changes today", async () => {
  const session = createNoaGoldenSession();
  const first = await session.send("What is today's status?");
  assert.ok(first.answer?.choices?.length);
  assert.equal(first.trace.scopeSource, "clarification");
  assert.equal(first.trace.clarifyReason, "business_options");
  const next = await session.send("Changes today.");
  assert.ok(next.answer);
  fallback(next.trace);
  assert.equal(next.trace.referenceAvailable, false);
});

test("CASE C CURRENT BASELINE: Project list reference exists but List them does not bind it", async () => {
  const session = createNoaGoldenSession();
  assert.equal((await session.send("Project status.")).trace.errorCode, null);
  const list = await session.send("List the projects.");
  assert.equal(list.trace.capabilitySelected, "Project");
  assert.equal(list.trace.resultCount, 2);
  assert.equal(session.snapshot().conversationReference?.domain, "Project");
  const next = await session.send("List them.");
  fallback(next.trace);
  assert.equal(next.trace.referenceAvailable, true);
  assert.equal(next.trace.referenceDomain, "Project");
  assert.equal(session.snapshot().conversationReference, undefined); // successful fallback clears it
});

test("CASE D CURRENT BASELINE: related-project request and continuation both use generic active scope", async () => {
  const session = createNoaGoldenSession();
  // Real capability returns a status COUNT (aggregate) for this wording; the fixture now mirrors
  // it, so the row-based resultCount is null rather than the old list-fixture artifact of 5.
  const status = await session.send("What is quotation status?");
  assert.equal(status.trace.capabilitySelected, "Quotation");
  assert.equal(status.trace.resultCount, null);
  assert.equal(status.trace.shadowResultKind, "aggregate");
  const confirmed = await session.send("Which are the two client confirmed?");
  assert.equal(confirmed.trace.capabilitySelected, "Quotation");
  assert.equal(confirmed.trace.resultCount, 2);
  // Phase 1C proof: shadow state captured aggregate -> list(count 2), while routing below is
  // still the known-wrong generic Project scope. Shadow state is never read by routing.
  const [aggregate, list] = session.shadow()!.state.resultSets;
  assert.equal(aggregate.kind, "aggregate");
  assert.equal(aggregate.count, 5);
  assert.equal(list.kind, "list");
  assert.equal(list.entityType, "quotation");
  assert.equal(list.count, 2);
  assert.equal(session.shadow()!.state.focus?.resultSetHandle, list.handle);
  for (const [message, referenceDomain] of [
    ["Can you mention the name of the project?", "Quotation"],
    ["List these two projects.", "Project"],
  ]) {
    const { answer, trace } = await session.send(message);
    assert.ok(answer);
    assert.equal(trace.errorCode, null);
    assert.equal(trace.capabilitySelected, "Project");
    assert.equal(trace.routeDecision, "Project");
    assert.equal(trace.referenceDomain, referenceDomain);
    assert.equal(trace.referenceBindingKind, "not_applicable");
    assert.equal(trace.scopeSource, "generic_query");
    assert.equal(trace.resultCount, 2);
    assert.equal(trace.semanticUsed, false);
  }
});

test("CASE E: exact Project identifier selects explicit scope", async () => {
  const { answer, trace } = await createNoaGoldenSession().send("Tell me about CO-0003-001");
  assert.equal(trace.errorCode, null);
  assert.equal(trace.capabilitySelected, "Project");
  assert.equal(trace.scopeSource, "explicit_identifier");
  assert.equal(trace.resultCount, 1);
  assert.equal(trace.semanticUsed, false);
  assert.equal(answer?.conversationReference?.entities?.[0]?.label, "CO-0003-001");
});

for (const [voice, typed] of [
  ["Hey Noah", "Hey NOA"], ["Hello Nova", "Hello NOA"],
  ["  hELLo NOVA!!!  ", "hELLo NOA!!!"],
  ["Hey Noah, tell me about CO-0003-001", "Hey NOA, tell me about CO-0003-001"],
  ["Hello Nova, tell me about CO-0003-001", "Hello NOA, tell me about CO-0003-001"],
]) {
  test(`voice transcript uses real realtime normalizer: ${voice}`, async () => {
    const normalized = normalizeNoaVoiceTranscript(voice);
    assert.equal(normalized, typed);
    const a = await createNoaGoldenSession().send(normalized);
    const b = await createNoaGoldenSession().send(typed);
    const { durationMs: _a, ...at } = a.trace;
    const { durationMs: _b, ...bt } = b.trace;
    assert.deepEqual(at, bt);
    // Independent sessions get different transport-only session ids; everything else is equal.
    assert.deepEqual({ ...a.answer, sessionId: undefined }, { ...b.answer, sessionId: undefined });
    assert.equal(a.trace.errorCode, null);
  });
}

test("voice CURRENT BASELINE: filler is retained and bare list continuity still fails", async () => {
  assert.equal(normalizeNoaVoiceTranscript("uh list them"), "uh list them");
  const session = createNoaGoldenSession();
  await session.send("List the projects.");
  fallback((await session.send(normalizeNoaVoiceTranscript("uh list them"))).trace);
  // Existing voice normalizer has NO business-ID correction. Do not invent one.
  assert.equal(normalizeNoaVoiceTranscript("CO zero zero zero three dash zero zero one"), "CO zero zero zero three dash zero zero one");
});
