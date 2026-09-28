// Phase 1C: runtime session lifecycle + shadow ResultSet capture. Real route, real orchestrator,
// real shadow builder; only the session repository (shared in-memory implementation from the
// golden harness), auth/profile lookup and capability reads are fixtures. Offline per TEST-MODE.md.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import {
  createNoaGoldenSession, createNoaGoldenSessionRepository, createNoaGoldenSessionStore, installNoaGoldenFixtures,
  NOA_GOLDEN_PROJECT_FILES, NOA_GOLDEN_QUOTATIONS,
} from "./testing/noa-golden-harness";
import { applyNoaConversationTurnState, noaSessionId } from "./noa-turn-state";
import { buildNoaShadowResultSet, runNoaShadowTurn, type NoaShadowTurnTrace } from "./noa-shadow-turn";
import { createNoaResultSetHandle, MAX_NOA_RESULT_SET_ITEMS, MAX_NOA_RESULT_SETS } from "./noa-result-set";
import type { NoaChatRequest } from "./noa-types";

installNoaGoldenFixtures(mock, { mockDatabase: false });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fixture-user" } } }) },
  from: (table: string) => {
    assert.equal(table, "profiles"); // the route itself never touches noa_sessions directly
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: null } }) }) }) };
  },
}) } });
const routeStore = createNoaGoldenSessionStore();
const routeRepository = createNoaGoldenSessionRepository(routeStore);
mock.module("@/lib/noa/noa-session.server", { namedExports: {
  loadOrCreateNoaSession: routeRepository.load, saveNoaSession: routeRepository.save,
} });
const { POST } = await import("../../app/api/noa/chat/route");
const { runNoaOrchestrator } = await import("./noa-orchestrator");

const context = { pathname: "/dashboard", section: "dashboard" as const };
const post = async (body: Record<string, unknown>) => {
  const response = await POST(new Request("http://localhost/api/noa/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context, ...body }),
  }));
  assert.equal(response.status, 200);
  return response.json();
};
const identity = () => ({ handle: createNoaResultSetHandle(), createdAt: "2026-09-28T08:00:00.000Z" });
function resetStore() {
  routeStore.sessions.clear();
  delete routeStore.loadFailure;
  delete routeStore.saveFailure;
}

// ── SESSION ROUND-TRIP (1-5) ─────────────────────────────────────────────────────────────────

test("1-3. no id creates a session, the response returns it, and the next turn reuses the same id", async () => {
  resetStore();
  const first = await post({ message: "Tell me about CO-0003-001" });
  assert.ok(noaSessionId(first.sessionId));
  assert.equal(routeStore.sessions.size, 1);
  const second = await post({ message: "List the projects.", sessionId: first.sessionId });
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(routeStore.sessions.size, 1);
  assert.equal(routeStore.sessions.get(first.sessionId)!.state.resultSets.length, 2);
});

test("4-5. an expired/unknown id is replaced, and the client adopts the replacement without looping", async () => {
  resetStore();
  const a = (await post({ message: "Hello" })).sessionId as string;
  routeStore.sessions.get(a)!.expired = true;
  const replaced = await post({ message: "Hello", sessionId: a });
  const b = replaced.sessionId as string;
  assert.ok(noaSessionId(b));
  assert.notEqual(b, a);
  // Client adoption uses the same shared helper as the component and harness.
  const adopted = applyNoaConversationTurnState({ sessionId: a }, replaced);
  assert.equal(adopted.sessionId, b);
  const next = await post({ message: "Hello", sessionId: adopted.sessionId });
  assert.equal(next.sessionId, b); // stable: no fresh-session loop
  assert.equal(routeStore.sessions.size, 2);
  // Unknown (never issued / other owner) behaves identically to expired.
  assert.notEqual((await post({ message: "Hello", sessionId: "11111111-1111-4111-8111-111111111111" })).sessionId, "11111111-1111-4111-8111-111111111111");
});

test("client helper: errors preserve the id; untrusted/malformed ids are ignored", () => {
  const previous = { sessionId: "22222222-2222-4222-8222-222222222222" };
  assert.equal(applyNoaConversationTurnState(previous), previous);
  assert.equal(noaSessionId("not-a-uuid"), undefined);
  assert.equal(noaSessionId({ id: "x" }), undefined);
  assert.equal(noaSessionId("22222222-2222-4222-8222-22222222222A"), "22222222-2222-4222-8222-22222222222a");
});

test("route treats a malformed client sessionId as absent", async () => {
  resetStore();
  const answer = await post({ message: "Hello", sessionId: "../../etc/passwd" });
  assert.ok(noaSessionId(answer.sessionId));
});

// ── SHADOW FAILURES (6-8): never alter the authoritative answer ─────────────────────────────

async function shadowAnswer(message: string, configure: (store: ReturnType<typeof createNoaGoldenSessionStore>) => void) {
  const store = createNoaGoldenSessionStore();
  configure(store);
  const traces: NoaShadowTurnTrace[] = [];
  const request: NoaChatRequest = { context, message };
  const answer = await runNoaShadowTurn(request, { ...createNoaGoldenSessionRepository(store), run: runNoaOrchestrator }, (t) => traces.push(t));
  return { answer, trace: traces[0], store, plain: await runNoaOrchestrator(request) };
}

test("6. storage error on save does not alter the answer", async () => {
  const { answer, trace, plain } = await shadowAnswer("Tell me about CO-0003-001", (s) => { s.saveFailure = "storage_error"; });
  assert.deepEqual({ ...answer, sessionId: undefined }, { ...plain, sessionId: undefined });
  assert.equal(trace.shadowSave, "error");
  assert.equal(trace.shadowResultKind, "entity");
});

test("7. version conflict: no retry, no answer change, stored state untouched", async () => {
  let saves = 0;
  const store = createNoaGoldenSessionStore();
  const repository = createNoaGoldenSessionRepository(store);
  const request: NoaChatRequest = { context, message: "List the projects." };
  const traces: NoaShadowTurnTrace[] = [];
  const answer = await runNoaShadowTurn(request, {
    load: async (id) => {
      const loaded = await repository.load(id);
      if (loaded.ok) store.sessions.get(loaded.session.sessionId)!.version = 9; // concurrent writer
      return loaded;
    },
    save: async (...args) => { saves += 1; return repository.save(...args); },
    run: runNoaOrchestrator,
  }, (t) => traces.push(t));
  const { sessionId, ...authoritative } = answer;
  assert.deepEqual(authoritative, await runNoaOrchestrator(request));
  assert.equal(traces[0].shadowSave, "version_conflict");
  assert.equal(saves, 1);
  assert.deepEqual(store.sessions.get(sessionId!)!.state.resultSets, []);
});

test("8. load failure/malformed state/raw throw: answer unchanged, no id, no raw error exposed", async () => {
  for (const failure of ["invalid_state", "storage_error", "throw"] as const) {
    const { answer, trace, plain } = await shadowAnswer("Tell me about CO-0003-001", (s) => { s.loadFailure = failure; });
    assert.deepEqual(answer, plain);
    assert.equal("sessionId" in answer, false);
    assert.equal(trace.sessionMode, "shadow_unavailable");
    assert.equal(trace.shadowSave, "skipped");
    assert.doesNotMatch(JSON.stringify({ answer, trace }), /raw storage detail|invalid_state|storage_error/);
  }
});

// ── RESULTSET MAPPINGS (9-14) ────────────────────────────────────────────────────────────────

test("9. Project exact lookup -> project_file entity (identifier only)", () => {
  const result = buildNoaShadowResultSet("Project", { kind: "project_file_detail", projectFile: NOA_GOLDEN_PROJECT_FILES[0], deterministicText: "prose" }, identity());
  assert.equal(result?.kind, "entity");
  assert.deepEqual(result?.kind === "entity" && result.items, [{ orderNo: "CO-0003-001" }]);
  assert.doesNotMatch(JSON.stringify(result), /Fixture Client|USD|15000|prose/);
});

test("10. Project list -> ordered project_file list preserving display order and total count", () => {
  const rows = [...NOA_GOLDEN_PROJECT_FILES].reverse();
  const result = buildNoaShadowResultSet("Project", { kind: "project_order_list", rows, totalMatching: 7, returnedCount: 3 }, identity());
  assert.equal(result?.kind, "list");
  assert.equal(result?.count, 7);
  assert.deepEqual(result?.kind === "list" && result.items, rows.map(({ orderNo }) => ({ orderNo })));
});

test("11. Quotation exact lookup -> quotation entity by UUID, never quotation number/name", () => {
  const id = NOA_GOLDEN_QUOTATIONS[0].id;
  for (const requestedField of ["detail", "total", "status"]) {
    const result = buildNoaShadowResultSet("Quotation", { id, quotationNo: "QN-1001", requestedField, client: "Fixture Client Delta", grandTotal: 4242.75 }, identity());
    assert.deepEqual(result?.kind === "entity" && result.items, [{ id }]);
    assert.doesNotMatch(JSON.stringify(result), /QN-1001|Fixture|4242\.75/);
  }
});

test("12. Quotation status-filtered list -> ordered quotation list with closed querySpec", () => {
  const rows = NOA_GOLDEN_QUOTATIONS.filter((q) => q.status === "client_confirmed");
  const result = buildNoaShadowResultSet("Quotation", { kind: "quotation_status_list", requestedStatus: "client_confirmed", totalMatching: 2, rows }, identity());
  assert.ok(result?.kind === "list" && result.entityType === "quotation");
  assert.deepEqual(result.items, rows.map(({ id }) => ({ id })));
  assert.deepEqual(result.querySpec, { capability: "quotation", operation: "status_list", filters: { status: "client_confirmed" } });
});

test("13. Quotation status summary -> aggregate with closed status groups", () => {
  const counts = [{ persistedStatus: "draft", displayLabel: "Pending", count: 2 }, { persistedStatus: "client_confirmed", displayLabel: "Client Confirmed", count: 2 }];
  const result = buildNoaShadowResultSet("Quotation", { kind: "quotation_status_count", totalCount: 4, counts }, identity());
  assert.ok(result?.kind === "aggregate");
  assert.deepEqual(result.groups, [{ status: "draft", count: 2 }, { status: "client_confirmed", count: 2 }]);
  assert.deepEqual(result.querySpec.filters, {}); // whole-aggregate: no single status was requested
});

test("Phase 1D PART 9: a single-status count ('how many pending') preserves that status in the querySpec filter", () => {
  const result = buildNoaShadowResultSet("Quotation", { kind: "quotation_status_count", totalCount: 2, counts: [{ persistedStatus: "draft", displayLabel: "Pending", count: 2 }] }, identity());
  assert.ok(result?.kind === "aggregate");
  assert.deepEqual(result.querySpec.filters, { status: "draft" });
  assert.deepEqual(result.groups, [{ status: "draft", count: 2 }]);
  // An unrecognized single status still falls back to an empty filter, never an invalid one.
  const unknown = buildNoaShadowResultSet("Quotation", { kind: "quotation_status_count", totalCount: 1, counts: [{ persistedStatus: "revised", count: 1 }] }, identity());
  assert.equal(unknown, null); // (also covered by test 14 below - an unmappable single group is rejected, not guessed)
});

test("14. unsupported or unmappable results create no ResultSet (and text is never examined)", () => {
  assert.equal(buildNoaShadowResultSet("Client", { kind: "client_record_detail", client: { id: "x" } }, identity()), null);
  assert.equal(buildNoaShadowResultSet("Help", { text: "Tell me about CO-0003-001" }, identity()), null);
  assert.equal(buildNoaShadowResultSet("Project", { deterministicText: "CO-0003-001 is active." }, identity()), null);
  // An unknown persisted status is rejected rather than dropped or guessed.
  assert.equal(buildNoaShadowResultSet("Quotation", { kind: "quotation_status_count", totalCount: 1, counts: [{ persistedStatus: "revised", count: 1 }] }, identity()), null);
  assert.equal(buildNoaShadowResultSet("Quotation", { kind: "quotation_status_list", requestedStatus: "revised", totalMatching: 0, rows: [] }, identity()), null);
});

// ── STACK / FOCUS (15-18) ────────────────────────────────────────────────────────────────────

test("15/17. stack is capped at 5 and the newest supported result is focused", async () => {
  const session = createNoaGoldenSession();
  for (const message of ["Tell me about CO-0003-001", "Tell me about CO-0004-001", "List the projects.",
    "What is quotation status?", "Which are the two client confirmed?", "show pending quotations"]) {
    assert.equal((await session.send(message)).trace.shadowSave, "saved", message);
  }
  const { state, version } = session.shadow()!;
  assert.equal(state.resultSets.length, MAX_NOA_RESULT_SETS);
  assert.equal(version, 6);
  assert.equal(state.resultSets[0].kind, "entity"); // oldest (CO-0003-001) evicted
  assert.equal(state.focus?.resultSetHandle, state.resultSets.at(-1)!.handle);
  assert.doesNotMatch(JSON.stringify(state), /Fixture Client|USD|QN-100|Pending/);
});

test("16. refs are capped at 50 while the total count is preserved", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ orderNo: `CO-${String(i + 1).padStart(4, "0")}-001` }));
  const result = buildNoaShadowResultSet("Project", { kind: "project_order_list", rows, totalMatching: 60 }, identity());
  assert.ok(result?.kind === "list");
  assert.equal(result.items.length, MAX_NOA_RESULT_SET_ITEMS);
  assert.equal(result.count, 60);
});

test("18. social/help/clarification turns preserve stack and focus (no save)", async () => {
  const session = createNoaGoldenSession();
  await session.send("List the projects.");
  const before = structuredClone(session.shadow()!);
  for (const message of ["Hello", "What is today's status?", "List them."]) {
    const { trace } = await session.send(message);
    assert.equal(trace.shadowSave, "skipped", message);
    assert.equal(trace.sessionMode, "shadow_loaded", message);
  }
  assert.deepEqual(session.shadow(), before);
});

// ── REGRESSION (19-23) ───────────────────────────────────────────────────────────────────────

test("19/20. shadow turn returns the orchestrator's exact answer; conversation/configuration references unchanged", async () => {
  const configuration = { templateId: "fixture-template", mode: "configuring" as const, selections: {} };
  const store = createNoaGoldenSessionStore();
  const dependencies = { ...createNoaGoldenSessionRepository(store), run: runNoaOrchestrator };
  let sessionId: string | undefined;
  let conversationReference: NoaChatRequest["conversationReference"];
  // Configuration is only paired with turns the fixtures can serve without a template DB read
  // (same pairing as noa-turn-state.test.mts): passthrough on an unrelated turn, then cancellation.
  for (const [message, productConfigurationReference] of [
    ["Tell me about CO-0003-001", undefined], ["What status is it?", undefined], ["List the projects.", configuration],
    ["List them.", undefined], ["cancel configuration", configuration],
  ] as const) {
    const request: NoaChatRequest = { context, message, conversationReference, productConfigurationReference };
    const { sessionId: returned, ...authoritative } = await runNoaShadowTurn({ ...request, sessionId }, dependencies);
    assert.deepEqual(authoritative, await runNoaOrchestrator(request), message);
    if (message === "List the projects.") assert.deepEqual(authoritative.productConfigurationReference, configuration);
    if (message === "cancel configuration") assert.equal(authoritative.productConfigurationReference, undefined);
    sessionId = returned;
    conversationReference = authoritative.conversationReference;
  }
});

test("21. shadow focus exists but routing still ignores it (Case C known failure unchanged)", async () => {
  const session = createNoaGoldenSession();
  await session.send("List the projects.");
  assert.equal(session.shadow()!.state.resultSets[0].kind, "list");
  const { trace } = await session.send("List them.");
  assert.equal(trace.routeDecision, "Help");
  assert.equal(trace.capabilitySelected, null);
});

test("23. typed, manual and realtime turns share one request path carrying the same session id", () => {
  const assistant = readFileSync("components/noa/noa-assistant.tsx", "utf8");
  const drawer = readFileSync("components/noa/noa-chat-drawer.tsx", "utf8");
  assert.equal((assistant.match(/requestNoaAnswer\(/g) ?? []).length, 2); // definition + single call site
  assert.ok(assistant.includes("productConfigurationReferenceRef.current, sessionIdRef.current)"));
  assert.ok(drawer.includes("useNoaRealtimeVoice(isOpen, onSend)"));
  assert.ok(drawer.includes("const manualSend = (text: string) => { realtime.stop(); void onSend(text); };"));
  assert.doesNotMatch(assistant, /localStorage|sessionStorage/);
});

test("trace carries closed shadow metadata only", async () => {
  const { trace } = await createNoaGoldenSession().send("Which are the two client confirmed?");
  assert.equal(trace.sessionMode, "shadow_created");
  assert.equal(trace.shadowResultKind, "list");
  assert.equal(trace.shadowResultEntityType, "quotation");
  assert.equal(trace.shadowSave, "saved");
  assert.doesNotMatch(JSON.stringify(trace), /[0-9a-f]{8}-[0-9a-f]{4}-|rs_[0-9a-f]{32}|QN-|CO-/);
});
