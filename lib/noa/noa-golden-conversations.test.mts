// Current architecture baselines: migrate these deliberately with Phase 1/2. Freeze: /AGENTS.md.
// Real orchestrator; fixture reads; disabled semantic runtime. See testing/TEST-MODE.md.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createNoaGoldenSession, installNoaGoldenFixtures, noaGoldenProjectCapabilityCalls, noaGoldenQuotationCapabilityCalls, NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS, NOA_GOLDEN_QUOTATIONS } from "./testing/noa-golden-harness";
import { normalizeNoaVoiceTranscript } from "../../components/noa/use-noa-realtime-voice";
import type { NoaPlannerInput } from "./noa-semantic-planner";
installNoaGoldenFixtures(mock, { mockDatabase: false });
// Offline fake scoped to the Phase 2 executors' own reads (auth gate, quotations by id, by status).
// Every other table stays unseeded, exactly like the harness default.
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "golden-user", user_metadata: {} } } }) },
  from(table: string) {
    if (table === "profiles") return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: "golden-user", role: "sales_designer", account_status: "active" }, error: null }) }) }) };
    if (table !== "quotations") throw new Error("Unseeded database access");
    let ids: unknown[] | null = null;
    let status: unknown = null;
    const builder = {
      select: () => builder,
      in: (_key: string, value: unknown[]) => { ids = value; return builder; },
      eq: (_key: string, value: unknown) => { status = value; return builder; },
      order: () => builder,
      limit: () => builder,
      returns: () => builder,
      then(resolve: (value: unknown) => void) {
        resolve({ error: null, data: NOA_GOLDEN_QUOTATIONS.filter((q) => (!ids || ids.includes(q.id)) && (status === null || q.status === status)).map((q) => ({
          id: q.id, quotation_no: q.quotationNo, status: q.status,
          layout_settings: q.projectOrderNo ? { projectFile: { orderNo: q.projectOrderNo, quotationId: q.id, quotationNo: q.quotationNo,
            clientId: "client", clientName: q.client, reference: q.projectOrderNo, total: 1, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", createdBy: "u" } } : {} })) });
      },
    };
    return builder;
  },
}) } });

// Mocks ONLY the planner provider boundary: one scripted structured plan per planned turn, built
// from the planner's own bounded input (handles by focus/recency/entity type - never item ids).
// Validation, execution, rendering and session persistence stay real.
type Summary = NoaPlannerInput["resultSets"][number];
const plan = (kind: string, source: Summary | null, fields: { relation?: string; status?: string; ordinal?: number | "last" } = {}) => ({
  kind, sourceResultSetHandle: source?.handle ?? null, relation: fields.relation ?? null, status: fields.status ?? null, ordinal: fields.ordinal ?? null,
});
const focusedSet = (input: NoaPlannerInput) => input.resultSets.find((result) => result.focused)!;
// Mirrors the hardened planner instructions' own rule (never noa-semantic-planner.server.ts's prose
// parsed here - just its "selectable" input field): the newest SELECTABLE (non-aggregate) result
// set of the given entity type. Used to reproduce the live UAT bug, where the live planner chose an
// aggregate/status-summary handle instead of the correctly-typed quotation list (see CASE G).
const newestSelectableOf = (input: NoaPlannerInput, entityType: string) =>
  input.resultSets.filter((result) => result.selectable && result.entityType === entityType).sort((a, b) => a.recency - b.recency)[0];
function scriptedPlanner(calls: NoaPlannerInput[], steps: Array<(input: NoaPlannerInput) => unknown>) {
  return async (input: NoaPlannerInput) => {
    calls.push(structuredClone(input));
    const step = steps.shift();
    assert.ok(step, "unexpected planner call");
    return step(input);
  };
}
const drillConfirmed = (input: NoaPlannerInput) => plan("aggregate_drilldown", focusedSet(input), { status: "client_confirmed" });
const relateFocused = (input: NoaPlannerInput) => plan("relation", focusedSet(input), { relation: "quotation.project_file" });
const CONFIRMED_IDS = NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS.map((q) => q.id);
const RELATED_ORDERS = NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS.map((q) => q.projectOrderNo!);

// Case D turns 1-3 shared by the D continuation and G rebinding cases.
async function caseDThroughProjects(steps: Array<(input: NoaPlannerInput) => unknown>) {
  const calls: NoaPlannerInput[] = [];
  const session = createNoaGoldenSession({ plan: scriptedPlanner(calls, [drillConfirmed, relateFocused, ...steps]) });
  const status = await session.send("What is quotation status?");
  assert.equal(status.trace.plannerMode, "skipped"); // no prior quotation scope yet
  assert.equal(status.trace.shadowResultKind, "aggregate");

  noaGoldenQuotationCapabilityCalls.length = 0;
  const confirmed = await session.send("Which are the two client confirmed?");
  // Native drill-down: drillDownNoaAggregate + deterministic renderer, never the legacy status-list route.
  assert.deepEqual([confirmed.trace.plannerAction, confirmed.trace.plannerExecution, confirmed.trace.scopeSource], ["aggregate_drilldown", "executed", "result_set"]);
  assert.deepEqual([confirmed.trace.capabilitySelected, confirmed.trace.resultCount], ["Quotation", 2]);
  assert.deepEqual(noaGoldenQuotationCapabilityCalls, []);
  for (const q of NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS) assert.match(confirmed.answer!.text, new RegExp(q.quotationNo));
  const [aggregate, quotations] = session.shadow()!.state.resultSets;
  assert.equal(aggregate.kind, "aggregate");
  assert.deepEqual(quotations.kind === "list" && quotations.items, CONFIRMED_IDS.map((id) => ({ id })));
  assert.equal(session.shadow()!.state.focus?.resultSetHandle, quotations.handle);

  noaGoldenProjectCapabilityCalls.length = 0;
  const projects = await session.send("Can you mention the name of the project?");
  assert.deepEqual([projects.trace.plannerAction, projects.trace.referenceBinding, projects.trace.scopeSource, projects.trace.resultCount],
    ["relation", "focused_result", "result_set", 2]);
  assert.deepEqual(noaGoldenProjectCapabilityCalls, RELATED_ORDERS.map((orderNo) => ({ message: orderNo, entity: orderNo })));
  assert.doesNotMatch(projects.answer!.text, /CO-0005-001/);
  const projectSet = session.shadow()!.state.resultSets[2];
  assert.deepEqual(projectSet.kind === "list" && projectSet.items, RELATED_ORDERS.map((orderNo) => ({ orderNo })));
  assert.equal(session.shadow()!.state.focus?.resultSetHandle, projectSet.handle);
  return { session, calls, quotations, projectSet };
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

test("CASE D PHASE 2: native drill-down, then the related-project follow-up binds the quotation ResultSet", async () => {
  const { session } = await caseDThroughProjects([]);
  assert.equal(session.shadow()!.state.resultSets.length, 3);
  assert.equal(session.shadow()!.version, 3);
});

test("CASE D CONTINUATION: 'List them.' re-shows the focused Project ResultSet, not a generic Project query", async () => {
  const { session, projectSet } = await caseDThroughProjects([(input) => plan("select", focusedSet(input))]);
  const version = session.shadow()!.version;
  noaGoldenProjectCapabilityCalls.length = 0;
  const { answer, trace } = await session.send("List them.");
  assert.deepEqual([trace.plannerAction, trace.referenceBinding, trace.resultSetRecency, trace.scopeSource, trace.capabilitySelected, trace.resultCount],
    ["select", "focused_result", "focused", "result_set", "Project", 2]);
  assert.deepEqual(noaGoldenProjectCapabilityCalls, RELATED_ORDERS.map((orderNo) => ({ message: orderNo, entity: orderNo })));
  for (const orderNo of RELATED_ORDERS) assert.match(answer!.text, new RegExp(orderNo));
  assert.doesNotMatch(answer!.text, /CO-0005-001/);
  // Reference-only: no duplicate set, focus unchanged, nothing saved.
  assert.equal(session.shadow()!.state.resultSets.length, 3);
  assert.equal(session.shadow()!.state.focus?.resultSetHandle, projectSet.handle);
  assert.deepEqual([session.shadow()!.version, trace.shadowSave], [version, "skipped"]);
});

// Live UAT bug: on Vercel the planner (Gemini) returned `select` over the QUOTATION AGGREGATE's
// handle for "Go back to the quotations." instead of the client-confirmed quotation LIST, and was
// correctly rejected as incompatible_type (see noa-semantic-planner.test.mts's "LIVE BUG" test for
// the validator-level proof). `newestSelectableOf` mirrors the hardened planner instructions' own
// rule (prefer a "selectable" - non-aggregate - result set), so this reproduces the exact live
// stack (older aggregate, older quotation list, focused newer Project list) end to end and proves
// the older LIST becomes focused, not the aggregate, with no duplicate ResultSet and the aggregate
// still present in the bounded history.
test("CASE G OLDER SET: 'Go back to the quotations.' refocuses the older LIST (never the aggregate); 'those' then relates from it", async () => {
  const { session, calls, quotations } = await caseDThroughProjects([
    (input) => plan("select", newestSelectableOf(input, "quotation")),
    relateFocused,
  ]);
  const back = await session.send("Go back to the quotations.");
  assert.deepEqual([back.trace.plannerAction, back.trace.referenceBinding, back.trace.resultSetRecency, back.trace.capabilitySelected],
    ["select", "older_result", "older", "Quotation"]);
  for (const q of NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS) assert.match(back.answer!.text, new RegExp(q.quotationNo));
  const afterBack = session.shadow()!.state;
  assert.equal(afterBack.resultSets.length, 3); // selected, not duplicated
  assert.equal(afterBack.resultSets[0].kind, "aggregate"); // the aggregate is still present in bounded history
  assert.equal(afterBack.focus?.resultSetHandle, quotations.handle); // focus moved to the LIST, never the aggregate
  assert.equal(back.trace.shadowSave, "saved");

  const those = await session.send("What projects are those for?");
  assert.equal(calls.at(-1)!.resultSets.find((result) => result.focused)?.handle, quotations.handle);
  assert.deepEqual([those.trace.plannerAction, those.trace.referenceBinding, those.trace.resultCount], ["relation", "focused_result", 2]);
  const state = session.shadow()!.state;
  assert.equal(state.resultSets.length, 4);
  const newest = state.resultSets.at(-1)!;
  assert.deepEqual(newest.kind === "list" && newest.items, RELATED_ORDERS.map((orderNo) => ({ orderNo })));
  assert.equal(state.focus?.resultSetHandle, newest.handle);
});

test("CASE F ORDINAL: 'the second one' resolves the second DISPLAYED quotation only", async () => {
  const calls: NoaPlannerInput[] = [];
  const session = createNoaGoldenSession({ plan: scriptedPlanner(calls, [(input) => plan("select", focusedSet(input), { ordinal: 2 })]) });
  const list = await session.send("Which are the client confirmed quotations?");
  assert.equal(list.trace.plannerMode, "skipped");
  assert.equal(list.trace.resultCount, 2);
  noaGoldenQuotationCapabilityCalls.length = 0;
  const { answer, trace } = await session.send("Tell me about the second one.");
  const second = NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS[1];
  assert.deepEqual([trace.plannerAction, trace.referenceBinding, trace.ordinalResolution, trace.capabilitySelected, trace.resultCount],
    ["select", "ordinal", "valid", "Quotation", 1]);
  assert.deepEqual(noaGoldenQuotationCapabilityCalls, [{ message: second.quotationNo, quotationNo: second.quotationNo }]);
  assert.match(answer!.text, new RegExp(second.quotationNo));
  assert.doesNotMatch(answer!.text, new RegExp(NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS[0].quotationNo));
  const state = session.shadow()!.state;
  const entity = state.resultSets.at(-1)!;
  assert.deepEqual([entity.kind, entity.kind === "entity" && entity.items], ["entity", [{ id: second.id }]]);
  assert.equal(state.focus?.resultSetHandle, entity.handle);
});

test("CASE H AMBIGUITY: two plausible sets produce a bounded deterministic clarification, not a guess", async () => {
  const { session } = await caseDThroughProjects([() => plan("clarify", null)]);
  const before = structuredClone(session.shadow()!);
  const { answer, trace } = await session.send("Tell me more about them.");
  assert.deepEqual([trace.plannerAction, trace.scopeSource, trace.clarifyReason, trace.capabilitySelected], ["clarify", "clarification", "semantic_clarification", null]);
  assert.equal(answer!.text, "I could use more than one recent result: the 2 Project Files, the 2 quotations or the quotation status summary. Which do you mean?");
  assert.deepEqual(session.shadow(), before);
});

test("PHASE 2 ACCEPTANCE: full UAT script keeps ResultSet continuity and every trace is closed and leak-free", async () => {
  const messages = ["What is quotation status?", "Which are the two client confirmed?", "What projects are those for?", "List them.",
    "Go back to the quotations.", "Tell me about the second one."];
  const { session } = await caseDThroughProjects([
    (input) => plan("select", focusedSet(input)),
    (input) => plan("select", newestSelectableOf(input, "quotation")), // never the quotation aggregate - see CASE G
    (input) => plan("select", focusedSet(input), { ordinal: 2 }),
  ]);
  const traces = [];
  for (const message of messages.slice(3)) traces.push((await session.send(message)).trace);
  assert.deepEqual(traces.map((t) => [t.plannerMode, t.plannerAction, t.referenceBinding, t.resultSetRecency, t.ordinalResolution, t.plannerExecution]), [
    ["planned", "select", "focused_result", "focused", "not_applicable", "executed"],
    ["planned", "select", "older_result", "older", "not_applicable", "executed"],
    ["planned", "select", "ordinal", "focused", "valid", "executed"],
  ]);
  assert.deepEqual(traces.map((t) => t.shadowSave), ["skipped", "saved", "saved"]);
  const state = session.shadow()!.state;
  const second = NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS[1];
  const newest = state.resultSets.at(-1)!;
  assert.deepEqual(newest.kind === "entity" && newest.items, [{ id: second.id }]);
  const leaks = [...state.resultSets.map((r) => r.handle), session.snapshot().sessionId!, ...NOA_GOLDEN_QUOTATIONS.flatMap((q) => [q.id, q.quotationNo, q.client]),
    ...RELATED_ORDERS, ...messages, "rs_", "Fixture"];
  for (const trace of traces) {
    const json = JSON.stringify(trace);
    for (const leak of leaks) assert.ok(!json.includes(leak), leak);
  }
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
