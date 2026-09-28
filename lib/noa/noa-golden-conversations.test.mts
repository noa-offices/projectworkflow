// Current architecture baselines: migrate these deliberately with Phase 1/2. Freeze: /AGENTS.md.
// Real orchestrator; fixture reads; disabled semantic runtime. See testing/TEST-MODE.md.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createNoaGoldenSession, installNoaGoldenFixtures, noaGoldenProjectCapabilityCalls, NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS, NOA_GOLDEN_QUOTATIONS } from "./testing/noa-golden-harness";
import { normalizeNoaVoiceTranscript } from "../../components/noa/use-noa-realtime-voice";
import type { NoaPlannerInput } from "./noa-semantic-planner";
installNoaGoldenFixtures(mock, { mockDatabase: false });
// Offline fake scoped to the Phase 2 relation executor's own reads (auth gate + quotations by id).
// Every other table stays unseeded, exactly like the harness default.
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "golden-user", user_metadata: {} } } }) },
  from(table: string) {
    if (table === "profiles") return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: "golden-user", role: "sales_designer", account_status: "active" }, error: null }) }) }) };
    if (table !== "quotations") throw new Error("Unseeded database access");
    let ids: unknown[] = [];
    const builder = {
      select: () => builder,
      in: (_key: string, value: unknown[]) => { ids = value; return builder; },
      returns: () => builder,
      then(resolve: (value: unknown) => void) {
        resolve({ error: null, data: NOA_GOLDEN_QUOTATIONS.filter((q) => ids.includes(q.id)).map((q) => ({ id: q.id,
          layout_settings: q.projectOrderNo ? { projectFile: { orderNo: q.projectOrderNo, quotationId: q.id, quotationNo: q.quotationNo,
            clientId: "client", clientName: q.client, reference: q.projectOrderNo, total: 1, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", createdBy: "u" } } : {} })) });
      },
    };
    return builder;
  },
}) } });

// Mocks ONLY the planner provider boundary: a scripted structured plan over the planner's own
// bounded input. Validation, relation execution, rendering and session persistence stay real.
function scriptedPlanner(calls: NoaPlannerInput[]) {
  return async (input: NoaPlannerInput) => {
    calls.push(structuredClone(input));
    const focused = input.resultSets.find((result) => result.focused)!;
    return focused.kind === "aggregate"
      ? { kind: "aggregate_drilldown", sourceResultSetHandle: focused.handle, relation: null, status: "client_confirmed" }
      : { kind: "relation", sourceResultSetHandle: focused.handle, relation: "quotation.project_file", status: null };
  };
}

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

test("CASE D PHASE 2: related-project follow-up binds the focused quotation ResultSet via the Semantic Planner", async () => {
  const plannerCalls: NoaPlannerInput[] = [];
  const session = createNoaGoldenSession({ plan: scriptedPlanner(plannerCalls) });
  const status = await session.send("What is quotation status?");
  assert.equal(status.trace.capabilitySelected, "Quotation");
  assert.equal(status.trace.shadowResultKind, "aggregate");
  assert.equal(status.trace.plannerMode, "skipped"); // no prior quotation scope yet

  // Validated aggregate_drilldown is delegated to the existing authoritative status-list capability.
  const confirmed = await session.send("Which are the two client confirmed?");
  assert.equal(confirmed.trace.plannerMode, "planned");
  assert.equal(confirmed.trace.plannerAction, "aggregate_drilldown");
  assert.equal(confirmed.trace.plannerExecution, "legacy");
  assert.equal(confirmed.trace.capabilitySelected, "Quotation");
  assert.equal(confirmed.trace.resultCount, 2);
  const [aggregate, list] = session.shadow()!.state.resultSets;
  assert.equal(aggregate.kind, "aggregate");
  assert.equal(list.kind, "list");
  assert.equal(list.entityType, "quotation");
  assert.deepEqual(list.kind === "list" && list.items, NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS.map((q) => ({ id: q.id })));
  assert.equal(session.shadow()!.state.focus?.resultSetHandle, list.handle);

  noaGoldenProjectCapabilityCalls.length = 0;
  const versionBefore = session.shadow()!.version;
  const { answer, trace } = await session.send("Can you mention the name of the project?");
  assert.ok(answer);
  assert.equal(trace.errorCode, null);
  assert.equal(trace.plannerMode, "planned");
  assert.equal(trace.plannerAction, "relation");
  assert.equal(trace.plannerSourceType, "quotation");
  assert.equal(trace.plannerValidation, "valid");
  assert.equal(trace.plannerExecution, "executed");
  assert.equal(trace.scopeSource, "result_set"); // not generic_query
  assert.equal(trace.capabilitySelected, "Project");
  assert.equal(trace.resultCount, 2);
  assert.equal(answer.domain, "Project");
  // Planner bound the focused quotation list, not the aggregate.
  assert.equal(plannerCalls.at(-1)!.resultSets.find((result) => result.focused)?.handle, list.handle);
  // Only exact authorized lookups of the related Project Files ran; the generic active list never did.
  const related = NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS.map((q) => q.projectOrderNo!);
  assert.deepEqual(noaGoldenProjectCapabilityCalls, related.map((orderNo) => ({ message: orderNo, entity: orderNo })));
  for (const orderNo of related) assert.match(answer.text, new RegExp(orderNo));
  assert.doesNotMatch(answer.text, /CO-0005-001/);

  const persisted = session.shadow()!;
  assert.equal(persisted.version, versionBefore + 1);
  assert.equal(persisted.state.resultSets.length, 3);
  assert.equal(persisted.state.resultSets[1].handle, list.handle); // prior scope preserved
  const projects = persisted.state.resultSets[2];
  assert.equal(projects.entityType, "project_file");
  assert.deepEqual(projects.kind === "list" && projects.items, related.map((orderNo) => ({ orderNo })));
  assert.equal(persisted.state.focus?.resultSetHandle, projects.handle);
  assert.equal(trace.shadowSave, "saved");

  // Phase 2 References (out of scope): "these two" over a Project ResultSet is not yet planned.
  const next = await session.send("List these two projects.");
  assert.equal(next.trace.plannerMode, "skipped");
  assert.equal(next.trace.scopeSource, "generic_query");
});

test("CASE D DEGRADED: planner unavailable keeps the legacy generic Project scope", async () => {
  const session = createNoaGoldenSession(); // real boundary + disabled fixture runtime
  await session.send("What is quotation status?");
  await session.send("Which are the two client confirmed?");
  const { answer, trace } = await session.send("Can you mention the name of the project?");
  assert.ok(answer);
  assert.equal(trace.plannerMode, "unavailable");
  assert.equal(trace.plannerValidation, "unavailable");
  assert.equal(trace.plannerExecution, "legacy");
  assert.equal(trace.capabilitySelected, "Project");
  assert.equal(trace.scopeSource, "generic_query");
  assert.equal(trace.semanticUsed, false);
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
