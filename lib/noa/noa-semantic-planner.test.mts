// Phase 2 Core: Semantic Planner contract, Quotations pilot gate, fallback and trace safety. The
// planner provider boundary and legacy orchestrator are stubs; validation, state transitions and
// the shared shadow-turn lifecycle are real. No Supabase/provider access (see TEST-MODE.md).
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { appendNoaResultSet, createEmptyNoaConversationState, type NoaConversationState } from "./noa-conversation-state";
import { createNoaResultSetHandle, type NoaResultSet } from "./noa-result-set";
import {
  buildNoaPlannerInput, buildNoaPlannerSchema, shouldRunNoaSemanticPlanner, validateNoaSemanticPlan, type NoaPlannerInput,
} from "./noa-semantic-planner";
import { runNoaShadowTurn, type NoaPlannerDependencies, type NoaShadowTurnTrace } from "./noa-shadow-turn";
import { createNoaGoldenSessionRepository, createNoaGoldenSessionStore } from "./testing/noa-golden-harness";
import type { NoaAnswer, NoaChatRequest } from "./noa-types";

mock.module("server-only", { defaultExport: {} });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => { throw new Error("Unseeded database access"); } } });
let runtime: { enabled: boolean; apiKeyConfigured: boolean; model?: string; provider?: string } = { enabled: false, apiKeyConfigured: false };
const providerRequests: Array<Record<string, unknown>> = [];
let providerReply: () => Promise<{ text: string }> = async () => ({ text: "{}" });
mock.module("@/lib/ai/resolve-agent-runtime-config.server", { namedExports: { resolveAiAgentRuntimeConfig: async () => runtime } });
mock.module("@/lib/ai/provider-router.server", { namedExports: {
  runAiProvider: async (request: Record<string, unknown>) => { providerRequests.push(request); return providerReply(); },
} });
const { requestNoaSemanticPlan } = await import("./noa-semantic-planner.server");

const T = "2026-01-01T00:00:00.000Z";
const QUOTATION_IDS = ["00000000-0000-4000-8000-000000001004", "00000000-0000-4000-8000-000000001005"];
const aggregate = (): NoaResultSet => ({
  handle: createNoaResultSetHandle(), createdAt: T, kind: "aggregate", entityType: "quotation", count: 5,
  querySpec: { capability: "quotation", operation: "status_summary", filters: {} },
  groups: [{ status: "draft", count: 3 }, { status: "client_confirmed", count: 2 }],
});
const quotationList = (): NoaResultSet => ({
  handle: createNoaResultSetHandle(), createdAt: T, kind: "list", entityType: "quotation", count: 2,
  items: QUOTATION_IDS.map((id) => ({ id })), querySpec: { capability: "quotation", operation: "status_list", filters: { status: "client_confirmed" } },
});
const projectList = (): NoaResultSet => ({
  handle: createNoaResultSetHandle(), createdAt: T, kind: "list", entityType: "project_file", count: 2,
  items: [{ orderNo: "CO-0003-001" }, { orderNo: "CO-0004-001" }],
});
function stateWith(...sets: NoaResultSet[]): NoaConversationState {
  return sets.reduce(appendNoaResultSet, createEmptyNoaConversationState());
}
const relationPlan = (handle: string) => ({ kind: "relation", sourceResultSetHandle: handle, relation: "quotation.project_file", status: null });

// ── Contract ───────────────────────────────────────────────────────────────────────────────────
test("1. valid relation plan over the focused quotation list is accepted", () => {
  const state = stateWith(aggregate(), quotationList());
  const handle = state.resultSets[1].handle;
  assert.deepEqual(validateNoaSemanticPlan(relationPlan(handle), state), {
    ok: true, plan: { kind: "relation", sourceResultSetHandle: handle, relation: "quotation.project_file", itemIndex: null }, sourceType: "quotation",
  });
});

test("2. valid aggregate drill-down plan is accepted only for a status the aggregate covered", () => {
  const state = stateWith(aggregate());
  const handle = state.resultSets[0].handle;
  const plan = { kind: "aggregate_drilldown", sourceResultSetHandle: handle, relation: null, status: "client_confirmed" };
  assert.equal(validateNoaSemanticPlan(plan, state).ok, true);
  assert.deepEqual(validateNoaSemanticPlan({ ...plan, status: "sent_to_client" }, state), { ok: false, reason: "incompatible_type", action: "aggregate_drilldown" });
});

test("3. unknown plan kinds, extra keys and non-objects are rejected", () => {
  const state = stateWith(quotationList());
  for (const raw of [{ kind: "sql", sourceResultSetHandle: null, relation: null, status: null }, { kind: "passthrough", tool: "x" }, null, "relation", []]) {
    assert.deepEqual(validateNoaSemanticPlan(raw, state), { ok: false, reason: "unsupported_operation", action: "none" });
  }
  assert.equal(validateNoaSemanticPlan({ kind: "passthrough", sourceResultSetHandle: state.resultSets[0].handle, relation: null, status: null }, state).ok, false);
});

test("4/22. arbitrary or unregistered relations are rejected", () => {
  const state = stateWith(quotationList());
  for (const relation of ["project_file.quotation", "quotations JOIN clients", "__proto__", null]) {
    assert.deepEqual(validateNoaSemanticPlan({ ...relationPlan(state.resultSets[0].handle), relation }, state),
      { ok: false, reason: "unsupported_operation", action: "relation" });
  }
});

test("5/20. nonexistent or forged ResultSet handles cannot execute", () => {
  const state = stateWith(quotationList());
  for (const handle of [createNoaResultSetHandle(), "rs_" + "0".repeat(32), QUOTATION_IDS[0], null]) {
    assert.deepEqual(validateNoaSemanticPlan(relationPlan(handle as string), state), { ok: false, reason: "invalid_handle", action: "relation" });
  }
});

test("6/21. incompatible ResultSet types are rejected", () => {
  const state = stateWith(aggregate(), projectList());
  assert.deepEqual(validateNoaSemanticPlan(relationPlan(state.resultSets[0].handle), state), { ok: false, reason: "incompatible_type", action: "relation" });
  assert.deepEqual(validateNoaSemanticPlan(relationPlan(state.resultSets[1].handle), state), { ok: false, reason: "incompatible_type", action: "relation" });
  const list = stateWith(quotationList());
  assert.deepEqual(validateNoaSemanticPlan({ kind: "aggregate_drilldown", sourceResultSetHandle: list.resultSets[0].handle, relation: null, status: "draft" }, list),
    { ok: false, reason: "incompatible_type", action: "aggregate_drilldown" });
});

test("7. unsupported statuses are rejected", () => {
  const state = stateWith(aggregate());
  for (const status of ["approved", "CLIENT_CONFIRMED", null]) {
    assert.equal(validateNoaSemanticPlan({ kind: "aggregate_drilldown", sourceResultSetHandle: state.resultSets[0].handle, relation: null, status }, state).ok, false);
  }
});

test("planner input is bounded and carries no business identifiers or assistant prose", () => {
  const state = stateWith(aggregate(), quotationList());
  const input = buildNoaPlannerInput(state, { message: "x".repeat(900), recentMessages: [
    { role: "assistant", text: "QN-1004 total USD 15,000 for Fixture Client Alpha" },
    ...["a", "b", "c", "d"].map((text) => ({ role: "user", text })),
  ] });
  assert.equal(input.message.length, 500);
  assert.deepEqual(input.recentUserMessages, ["b", "c", "d"]);
  const json = JSON.stringify(input);
  for (const leak of [...QUOTATION_IDS, "USD", "Fixture", "QN-1004", "15,000"]) assert.ok(!json.includes(leak), leak);
  assert.deepEqual(input.resultSets.map((result) => [result.kind, result.focused, result.statusFilter]),
    [["aggregate", false, null], ["list", true, "client_confirmed"]]);
  const schema = buildNoaPlannerSchema(input) as { properties: { sourceResultSetHandle: { enum: unknown[] } } };
  assert.deepEqual(schema.properties.sourceResultSetHandle.enum, [...state.resultSets.map((result) => result.handle), null]);
});

// ── Provider boundary ──────────────────────────────────────────────────────────────────────────
test("provider boundary: same strict request for every provider; unavailable/invalid output never fabricates a plan", async () => {
  const input = buildNoaPlannerInput(stateWith(quotationList()), { message: "which projects?" });
  runtime = { enabled: false, apiKeyConfigured: false };
  assert.equal(await requestNoaSemanticPlan(input), null);
  assert.equal(providerRequests.length, 0);
  const seen: string[] = [];
  for (const provider of ["openai", "anthropic", "gemini"]) {
    runtime = { enabled: true, apiKeyConfigured: true, model: "m", provider };
    providerReply = async () => ({ text: JSON.stringify(relationPlan(input.resultSets[0].handle)) });
    assert.deepEqual(await requestNoaSemanticPlan(input), relationPlan(input.resultSets[0].handle));
    const { provider: used, ...request } = providerRequests.at(-1)!;
    assert.equal(used, provider);
    seen.push(JSON.stringify(request));
  }
  assert.equal(new Set(seen).size, 1);
  for (const reply of [async () => ({ text: "not json" }), async () => ({ text: "" }), async () => { throw new Error("timeout"); }]) {
    providerReply = reply;
    assert.equal(await requestNoaSemanticPlan(input), null);
  }
  runtime = { enabled: false, apiKeyConfigured: false };
});

// ── Pilot gate / shared lifecycle ──────────────────────────────────────────────────────────────
function harness(initial: NoaConversationState, planner: Partial<NoaPlannerDependencies> & { plan: NoaPlannerDependencies["plan"] }) {
  const store = createNoaGoldenSessionStore();
  const sessionId = globalThis.crypto.randomUUID();
  store.sessions.set(sessionId, { state: initial, version: 1 });
  const calls = { legacy: 0, plan: 0, relate: 0, drillDown: 0 };
  const legacy: NoaAnswer = { domain: "Project", sources: [], text: "legacy" };
  const deps = {
    ...createNoaGoldenSessionRepository(store),
    run: (async (_request: NoaChatRequest, collect?: (trace: never) => void) => {
      calls.legacy += 1;
      collect?.({ routeDecision: "Project", semanticUsed: false, referenceAvailable: false, referenceDomain: null, referenceBindingKind: "not_applicable",
        scopeSource: "generic_query", capabilitySelected: "Project", resultCount: 2, clarifyReason: null, errorCode: null, durationMs: 0 } as never);
      return legacy;
    }) as never,
    planner: {
      plan: async (input: NoaPlannerInput) => { calls.plan += 1; return planner.plan(input); },
      relate: planner.relate ?? (async (state, handle) => {
        calls.relate += 1;
        assert.ok(state.resultSets.some((result) => result.handle === handle));
        return { ok: true, resultSet: projectList(), sourceCount: 2, matchedCount: 2, resultCount: 2 };
      }),
      drillDown: planner.drillDown ?? (async (state, handle, status) => {
        calls.drillDown += 1;
        assert.equal(state.resultSets.find((result) => result.handle === handle)?.kind, "aggregate");
        assert.equal(status, "client_confirmed");
        return { ok: true, resultSet: quotationList(), sourceCount: 2, matchedCount: 2, resultCount: 2 };
      }),
      describeProjectFiles: planner.describeProjectFiles ?? (async (orderNos) => ({ domain: "Project", sources: [], text: orderNos.join(", ") })),
      describeQuotations: planner.describeQuotations ?? (async (ids) => ({ domain: "Quotation", sources: [], text: ids.join(", ") })),
    } satisfies NoaPlannerDependencies,
  };
  async function send(message: string, extra: Partial<NoaChatRequest> = {}) {
    let trace: NoaShadowTurnTrace | undefined;
    const answer = await runNoaShadowTurn({ context: { pathname: "/", section: "dashboard" }, message, sessionId, ...extra }, deps, (value) => { trace = { ...value }; });
    return { answer, trace: trace!, row: store.sessions.get(sessionId)! };
  }
  return { send, calls, store };
}
const focusedRelation = async (input: NoaPlannerInput) => relationPlan(input.resultSets.find((result) => result.focused)!.handle);

test("8. no quotation ResultSet in the stack: planner skipped, legacy answers", async () => {
  for (const state of [createEmptyNoaConversationState(), stateWith(projectList())]) {
    const h = harness(state, { plan: focusedRelation });
    const { answer, trace } = await h.send("which projects?");
    assert.equal(answer.text, "legacy");
    assert.deepEqual([h.calls.plan, trace.plannerMode, trace.plannerAction], [0, "skipped", "none"]);
  }
});

test("9. unrelated Product turn: planner passthrough keeps legacy behavior and state", async () => {
  const state = stateWith(quotationList());
  const h = harness(state, { plan: async () => ({ kind: "passthrough", sourceResultSetHandle: null, relation: null, status: null }) });
  const { answer, trace, row } = await h.send("Show me product LED-100");
  assert.equal(answer.text, "legacy");
  assert.deepEqual([trace.plannerMode, trace.plannerAction, trace.plannerExecution, trace.scopeSource], ["planned", "passthrough", "legacy", "generic_query"]);
  assert.deepEqual(row.state, state);
});

test("10/26/27. exact business IDs and active Product Configuration never reach the planner", async () => {
  const h = harness(stateWith(quotationList()), { plan: focusedRelation });
  for (const [message, extra] of [["Tell me about CO-0003-001", {}], ["What about QN-1004?", {}],
    ["which projects?", { productConfigurationReference: { kind: "product_configuration" } as never }]] as const) {
    const { answer, trace } = await h.send(message, extra);
    assert.equal(answer.text, "legacy");
    assert.equal(trace.plannerMode, "skipped");
  }
  assert.equal(h.calls.plan, 0);
  assert.equal(shouldRunNoaSemanticPlanner(stateWith(quotationList()), { message: "Tell me about co-0003-001" }), false);
});

test("11. planner unavailable (null/throw): legacy fallback, no retry", async () => {
  for (const plan of [async () => null, async () => { throw new Error("provider down"); }]) {
    const h = harness(stateWith(quotationList()), { plan });
    const { answer, trace } = await h.send("which projects?");
    assert.equal(answer.text, "legacy");
    assert.deepEqual([h.calls.plan, h.calls.legacy, trace.plannerMode, trace.plannerValidation, trace.plannerExecution], [1, 1, "unavailable", "unavailable", "legacy"]);
  }
});

test("12/20. invalid planner output (forged handle, unknown kind) falls back to legacy without executing", async () => {
  for (const [raw, validation] of [[relationPlan(createNoaResultSetHandle()), "invalid_handle"],
    [{ kind: "delete_all" }, "unsupported_operation"]] as const) {
    const h = harness(stateWith(quotationList()), { plan: async () => raw });
    const { answer, trace } = await h.send("which projects?");
    assert.equal(answer.text, "legacy");
    assert.equal(h.calls.relate, 0);
    assert.deepEqual([trace.plannerMode, trace.plannerValidation, trace.plannerExecution], ["invalid", validation, "legacy"]);
  }
});

test("15-19. valid relation plan preempts legacy, pushes/focuses the Project ResultSet and persists it", async () => {
  const state = stateWith(aggregate(), quotationList());
  const h = harness(state, { plan: focusedRelation });
  const { answer, trace, row } = await h.send("which projects?");
  assert.equal(h.calls.legacy, 0);
  assert.equal(answer.text, "CO-0003-001, CO-0004-001");
  assert.deepEqual([trace.plannerMode, trace.plannerAction, trace.plannerSourceType, trace.plannerValidation, trace.plannerExecution],
    ["planned", "relation", "quotation", "valid", "executed"]);
  assert.deepEqual([trace.scopeSource, trace.capabilitySelected, trace.resultCount, trace.shadowSave, trace.shadowResultEntityType],
    ["result_set", "Project", 2, "saved", "project_file"]);
  assert.equal(row.version, 2);
  assert.deepEqual(row.state.resultSets.slice(0, 2), state.resultSets);
  assert.equal(row.state.focus?.resultSetHandle, row.state.resultSets[2].handle);
  assert.equal(row.state.resultSets[2].entityType, "project_file");
});

test("23. executor refusal (unauthorized/storage) returns to legacy; nothing is pushed", async () => {
  for (const reason of ["unauthorized", "storage_error"] as const) {
    const state = stateWith(quotationList());
    const h = harness(state, { plan: focusedRelation, relate: async () => ({ ok: false, reason }) });
    const { answer, trace, row } = await h.send("which projects?");
    assert.equal(answer.text, "legacy");
    assert.deepEqual([trace.plannerMode, trace.plannerExecution], ["planned", "legacy"]);
    assert.deepEqual(row.state, state);
  }
});

test("empty relation result answers truthfully without pushing empty scope", async () => {
  const state = stateWith(quotationList());
  const h = harness(state, { plan: focusedRelation, relate: async () => ({ ok: true, resultSet: { ...projectList(), kind: "list", count: 0, items: [] } as NoaResultSet, sourceCount: 2, matchedCount: 0, resultCount: 0 }) });
  const { trace, row } = await h.send("which projects?");
  assert.deepEqual([trace.plannerExecution, trace.resultCount, trace.shadowSave], ["executed", 0, "skipped"]);
  assert.deepEqual(row.state, state);
});

test("clarify plan: bounded deterministic clarification, state untouched", async () => {
  const state = stateWith(aggregate(), quotationList());
  const h = harness(state, { plan: async () => ({ kind: "clarify", sourceResultSetHandle: null, relation: null, status: null }) });
  const { answer, trace, row } = await h.send("what about those?");
  assert.equal(h.calls.legacy, 0);
  assert.equal(answer.domain, "Help");
  assert.deepEqual([trace.plannerAction, trace.scopeSource, trace.clarifyReason], ["clarify", "clarification", "semantic_clarification"]);
  assert.deepEqual(row.state, state);
});

test("version conflict: answer still authoritative, state not overwritten, conflict traced, no retry", async () => {
  const state = stateWith(quotationList());
  const h = harness(state, { plan: focusedRelation });
  h.store.saveFailure = "version_conflict";
  const { answer, trace, row } = await h.send("which projects?");
  assert.equal(answer.text, "CO-0003-001, CO-0004-001");
  assert.equal(trace.shadowSave, "version_conflict");
  assert.deepEqual([row.version, row.state], [1, state]);
});

test("24/25. planner trace is closed metadata and leaks no handles, identifiers or prompts", async () => {
  const state = stateWith(aggregate(), quotationList());
  const h = harness(state, { plan: focusedRelation });
  const { trace } = await h.send("Can you mention the name of the project? secret-marker");
  const json = JSON.stringify(trace);
  for (const leak of [...state.resultSets.map((result) => result.handle), ...QUOTATION_IDS, "CO-0003", "secret-marker", "rs_"]) {
    assert.ok(!json.includes(leak), leak);
  }
});

// ── Phase 2 References ─────────────────────────────────────────────────────────────────────────
const selectPlan = (handle: string, ordinal: number | "last" | null = null) => ({ kind: "select", sourceResultSetHandle: handle, relation: null, status: null, ordinal });
const idAt = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const quotationListOf = (ids: string[]): NoaResultSet => ({ handle: createNoaResultSetHandle(), createdAt: T, kind: "list", entityType: "quotation", count: ids.length, items: ids.map((id) => ({ id })) });

test("R1/R2. focused and older ResultSets are both selectable by handle", () => {
  const state = stateWith(quotationList(), projectList());
  for (const source of state.resultSets) {
    assert.deepEqual(validateNoaSemanticPlan(selectPlan(source.handle), state),
      { ok: true, plan: { kind: "select", sourceResultSetHandle: source.handle, itemIndex: null }, sourceType: source.entityType });
  }
  const input = buildNoaPlannerInput(state, { message: "go back" });
  assert.deepEqual(input.resultSets.map((result) => [result.entityType, result.focused, result.recency]), [["quotation", false, 1], ["project_file", true, 0]]);
});

test("R3/R4. nonexistent and evicted handles are rejected; evicted sets are never resurrected", () => {
  const evicted = quotationList();
  const state = stateWith(evicted, ...Array.from({ length: 5 }, () => projectList()));
  assert.equal(state.resultSets.length, 5);
  for (const handle of [evicted.handle, createNoaResultSetHandle()]) {
    assert.deepEqual(validateNoaSemanticPlan(selectPlan(handle), state), { ok: false, reason: "invalid_handle", action: "select" });
    assert.deepEqual(validateNoaSemanticPlan(relationPlan(handle), state), { ok: false, reason: "invalid_handle", action: "relation" });
  }
});

test("R5. aggregate sets cannot be selected or addressed by ordinal", () => {
  const state = stateWith(aggregate());
  const handle = state.resultSets[0].handle;
  assert.deepEqual(validateNoaSemanticPlan(selectPlan(handle), state), { ok: false, reason: "incompatible_type", action: "select" });
  assert.deepEqual(validateNoaSemanticPlan(selectPlan(handle, 1), state), { ok: false, reason: "incompatible_type", action: "select" });
  assert.equal(validateNoaSemanticPlan({ kind: "aggregate_drilldown", sourceResultSetHandle: handle, relation: null, status: "client_confirmed", ordinal: 1 }, state).ok, false);
});

test("R6-R10. ordinals resolve against stored display order; out-of-range and unsupported values are rejected", () => {
  const ids = [idAt(9), idAt(3), idAt(7)]; // deliberately not sorted: display order is array order
  const state = stateWith(quotationListOf(ids));
  const handle = state.resultSets[0].handle;
  for (const [ordinal, index] of [[1, 0], [2, 1], [3, 2], ["last", 2]] as const) {
    const result = validateNoaSemanticPlan(selectPlan(handle, ordinal), state);
    assert.ok(result.ok && result.plan.kind === "select");
    assert.equal(result.ok && result.plan.kind === "select" && result.plan.itemIndex, index);
  }
  assert.deepEqual(validateNoaSemanticPlan(selectPlan(handle, 4), state), { ok: false, reason: "out_of_range", action: "select" });
  for (const ordinal of [0, -1, 1.5, "2", "second", 11]) {
    assert.deepEqual(validateNoaSemanticPlan(selectPlan(handle, ordinal as never), state), { ok: false, reason: "unsupported_operation", action: "select" });
  }
  const entity = stateWith({ handle: createNoaResultSetHandle(), createdAt: T, kind: "entity", entityType: "quotation", count: 1, items: [{ id: idAt(1) }] });
  assert.equal(validateNoaSemanticPlan(selectPlan(entity.resultSets[0].handle, 1), entity).ok, true);
  assert.equal(validateNoaSemanticPlan(selectPlan(entity.resultSets[0].handle, 2), entity).ok, false);
});

test("R10/R11. 'the second one' pushes and focuses the second displayed item as entity scope", async () => {
  const ids = [idAt(9), idAt(3), idAt(7)];
  const state = stateWith(quotationListOf(ids));
  const rendered: string[][] = [];
  const h = harness(state, { plan: async (input) => selectPlan(input.resultSets[0].handle, 2), describeQuotations: async (shown) => {
    rendered.push(shown); return { domain: "Quotation", sources: [], text: shown.join(", ") };
  } });
  const { trace, row } = await h.send("the second one");
  assert.deepEqual(rendered, [[idAt(3)]]);
  assert.deepEqual([trace.plannerAction, trace.referenceBinding, trace.ordinalResolution, trace.resultSetRecency, h.calls.legacy], ["select", "ordinal", "valid", "focused", 0]);
  const entity = row.state.resultSets[1];
  assert.deepEqual([entity.kind, entity.kind === "entity" && entity.items], ["entity", [{ id: idAt(3) }]]);
  assert.equal(row.state.focus?.resultSetHandle, entity.handle);
  assert.deepEqual(row.state.resultSets[0], state.resultSets[0]);
});

test("R9. out-of-range ordinal gets a bounded clarification, no guess and no state change", async () => {
  const state = stateWith(quotationList());
  const h = harness(state, { plan: async (input) => selectPlan(input.resultSets[0].handle, 5) });
  const { answer, trace, row } = await h.send("the fifth one");
  assert.equal(h.calls.legacy, 0);
  assert.equal(answer.text, "That list only has 2 items. Which one do you mean?");
  assert.deepEqual([trace.plannerMode, trace.plannerValidation, trace.ordinalResolution, trace.scopeSource], ["invalid", "out_of_range", "out_of_range", "clarification"]);
  assert.deepEqual([row.version, row.state], [1, state]);
});

test("R12/R19. selecting an older set moves focus to it without duplicating it", async () => {
  const state = stateWith(aggregate(), quotationList(), projectList());
  const older = state.resultSets[1];
  const h = harness(state, { plan: async () => selectPlan(older.handle) });
  const { answer, trace, row } = await h.send("go back to the quotations");
  assert.equal(answer.text, QUOTATION_IDS.join(", "));
  assert.deepEqual([trace.referenceBinding, trace.resultSetRecency, trace.shadowSave], ["older_result", "older", "saved"]);
  assert.deepEqual(row.state.resultSets, state.resultSets);
  assert.equal(row.state.focus?.resultSetHandle, older.handle);
});

test("R11. re-selecting the focused set ('show those again') changes nothing and saves nothing", async () => {
  const state = stateWith(quotationList(), projectList());
  const h = harness(state, { plan: async (input) => selectPlan(input.resultSets.find((result) => result.focused)!.handle) });
  const { answer, trace, row } = await h.send("show those again");
  assert.equal(answer.text, "CO-0003-001, CO-0004-001");
  assert.deepEqual([trace.referenceBinding, trace.shadowSave, row.version], ["focused_result", "skipped", 1]);
  assert.deepEqual(row.state, state);
});

test("R13. ambiguous reference: deterministic choices from state metadata only", async () => {
  const state = stateWith(aggregate(), quotationList(), projectList());
  const h = harness(state, { plan: async () => ({ kind: "clarify", sourceResultSetHandle: null, relation: null, status: null, ordinal: null }) });
  const { answer, row } = await h.send("them");
  assert.equal(answer.text, "I could use more than one recent result: the 2 Project Files, the 2 quotations or the quotation status summary. Which do you mean?");
  assert.deepEqual(row.state, state);
});

test("R15-R18. aggregate drill-down runs the native executor, pushes/focuses the list, never the legacy route", async () => {
  const state = stateWith(aggregate());
  const h = harness(state, { plan: async (input) => ({ kind: "aggregate_drilldown", sourceResultSetHandle: input.resultSets[0].handle, relation: null, status: "client_confirmed", ordinal: null }) });
  const { answer, trace, row } = await h.send("which are the two client confirmed?");
  assert.deepEqual([h.calls.drillDown, h.calls.legacy], [1, 0]);
  assert.equal(answer.text, QUOTATION_IDS.join(", "));
  assert.deepEqual([trace.plannerAction, trace.plannerExecution, trace.capabilitySelected, trace.resultCount, trace.shadowResultEntityType],
    ["aggregate_drilldown", "executed", "Quotation", 2, "quotation"]);
  assert.equal(row.state.resultSets.length, 2);
  assert.equal(row.state.focus?.resultSetHandle, row.state.resultSets[1].handle);
});

test("aggregate drill-down executor refusal falls back safely; nothing is pushed", async () => {
  const state = stateWith(aggregate());
  const h = harness(state, { plan: async (input) => ({ kind: "aggregate_drilldown", sourceResultSetHandle: input.resultSets[0].handle, relation: null, status: "client_confirmed", ordinal: null }),
    drillDown: async () => ({ ok: false, reason: "unauthorized" }) });
  const { answer, row } = await h.send("which are confirmed?");
  assert.equal(answer.text, "legacy");
  assert.deepEqual(row.state, state);
});

test("ordinal relation relates only that displayed item; prior sets preserved", async () => {
  const ids = [idAt(9), idAt(3)];
  const state = stateWith(aggregate(), quotationListOf(ids));
  let related: string[] = [];
  const h = harness(state, {
    plan: async (input) => ({ ...relationPlan(input.resultSets[1].handle), ordinal: 1 }),
    relate: async (relState, handle) => {
      const source = relState.resultSets.find((result) => result.handle === handle)!;
      related = source.kind === "entity" && source.entityType === "quotation" ? source.items.map((item) => item.id) : [];
      return { ok: true, resultSet: { ...projectList(), kind: "entity", count: 1, items: [{ orderNo: "CO-0003-001" }] } as NoaResultSet, sourceCount: 1, matchedCount: 1, resultCount: 1 };
    },
  });
  const { trace, row } = await h.send("what project is the first one for?");
  assert.deepEqual(related, [idAt(9)]);
  assert.deepEqual([trace.plannerAction, trace.referenceBinding], ["relation", "ordinal"]);
  assert.deepEqual(row.state.resultSets.slice(0, 2), state.resultSets);
  assert.deepEqual(row.state.resultSets.map((result) => [result.kind, result.entityType]), [["aggregate", "quotation"], ["list", "quotation"], ["entity", "quotation"], ["entity", "project_file"]]);
  assert.equal(row.state.focus?.resultSetHandle, row.state.resultSets[3].handle);
});

test("R21. the 5-set bound still holds after a planner push", async () => {
  const state = stateWith(projectList(), projectList(), projectList(), projectList(), quotationList());
  const h = harness(state, { plan: focusedRelation });
  const { row } = await h.send("which projects?");
  assert.equal(row.state.resultSets.length, 5);
  assert.deepEqual(row.state.resultSets.slice(0, 4), state.resultSets.slice(1));
});

test("R14. no phrase-specific reference aliases in the planner path", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["noa-semantic-planner.ts", "noa-semantic-planner.server.ts", "noa-shadow-turn.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\/[^/\n]*\b(them|these|those|this|it|first|second|third|last|go back)\b[^/\n]*\/[a-z]*\.test\(/i, file);
    assert.doesNotMatch(source, /message(\.toLowerCase\(\))?\.(includes|match|startsWith)\(/, file);
  }
});

// ── Planner runtime diagnostics (debug-only; behavior unchanged) ─────────────────────────────
test("planner diagnostics: runtime_disabled, credential_missing, timeout, provider_failed, invalid_json, success", async (t) => {
  const logs: unknown[] = [];
  const originalInfo = console.info;
  const originalEnv = process.env.NOA_DEBUG_ROUTING;
  console.info = (...args: unknown[]) => { if (args[0] === "[NOA_PLANNER_DIAG]") logs.push(JSON.parse(args[1] as string)); };
  process.env.NOA_DEBUG_ROUTING = "1";
  t.after(() => { console.info = originalInfo; if (originalEnv === undefined) delete process.env.NOA_DEBUG_ROUTING; else process.env.NOA_DEBUG_ROUTING = originalEnv; });

  const scenarios: Array<{
    runtime: { enabled: boolean; apiKeyConfigured: boolean; provider: string; model: string; source: { provider: string; model: string } };
    run: () => Promise<{ text: string }>;
    outcome: string;
  }> = [
    { runtime: { enabled: false, apiKeyConfigured: false, provider: "openai", model: "gpt-4.1-mini", source: { provider: "registry_default", model: "registry_default" } },
      run: async () => { throw new Error("must not call provider"); }, outcome: "runtime_disabled" },
    { runtime: { enabled: true, apiKeyConfigured: false, provider: "gemini", model: "gemini-3.5-flash-lite", source: { provider: "global_default", model: "provider_default" } },
      run: async () => { throw new Error("must not call provider"); }, outcome: "credential_missing" },
    { runtime: { enabled: true, apiKeyConfigured: true, provider: "openai", model: "gpt-4.1-mini", source: { provider: "registry_default", model: "registry_default" } },
      run: async () => { const { AiProviderError } = await import("@/lib/ai/types"); throw new AiProviderError("timed out", "timeout"); }, outcome: "timeout" },
    { runtime: { enabled: true, apiKeyConfigured: true, provider: "anthropic", model: "claude-sonnet-4-6", source: { provider: "agent_override", model: "agent_override" } },
      run: async () => { const { AiProviderError } = await import("@/lib/ai/types"); throw new AiProviderError("boom", "provider_failed"); }, outcome: "provider_failed" },
    { runtime: { enabled: true, apiKeyConfigured: true, provider: "openai", model: "gpt-4.1-mini", source: { provider: "registry_default", model: "registry_default" } },
      run: async () => ({ text: "not json" }), outcome: "invalid_json" },
    { runtime: { enabled: true, apiKeyConfigured: true, provider: "openai", model: "gpt-4.1-mini", source: { provider: "registry_default", model: "registry_default" } },
      run: async () => ({ text: JSON.stringify({ kind: "passthrough", sourceResultSetHandle: null, relation: null, status: null, ordinal: null }) }), outcome: "success" },
  ];

  for (const scenario of scenarios) {
    logs.length = 0;
    runtime = scenario.runtime as never;
    providerReply = scenario.run;
    const input = buildNoaPlannerInput(stateWith(quotationList()), { message: "x" });
    const result = await requestNoaSemanticPlan(input);
    if (scenario.outcome === "success") assert.deepEqual(result, { kind: "passthrough", sourceResultSetHandle: null, relation: null, status: null, ordinal: null });
    else assert.equal(result, null);
    assert.equal(logs.length, 1);
    const entry = logs[0] as Record<string, unknown>;
    assert.equal(entry.outcome, scenario.outcome);
    assert.equal(entry.provider, scenario.runtime.provider);
    assert.equal(entry.model, scenario.runtime.model);
    assert.equal(entry.timeoutMs, 4_000);
    assert.equal(typeof entry.durationMs, "number");
    if (scenario.outcome === "provider_failed" || scenario.outcome === "timeout") assert.equal(entry.providerErrorKind, scenario.outcome);
  }
  runtime = { enabled: false, apiKeyConfigured: false };
});

test("planner diagnostics: unexpected error still returns null and is classified separately", async (t) => {
  const logs: unknown[] = [];
  const originalInfo = console.info;
  const originalEnv = process.env.NOA_DEBUG_ROUTING;
  console.info = (...args: unknown[]) => { if (args[0] === "[NOA_PLANNER_DIAG]") logs.push(JSON.parse(args[1] as string)); };
  process.env.NOA_DEBUG_ROUTING = "1";
  t.after(() => { console.info = originalInfo; if (originalEnv === undefined) delete process.env.NOA_DEBUG_ROUTING; else process.env.NOA_DEBUG_ROUTING = originalEnv; });

  runtime = { enabled: true, apiKeyConfigured: true, provider: "openai", model: "gpt-4.1-mini", source: { provider: "registry_default", model: "registry_default" } } as never;
  providerReply = async () => { throw new Error("network exploded"); };
  const input = buildNoaPlannerInput(stateWith(quotationList()), { message: "x" });
  assert.equal(await requestNoaSemanticPlan(input), null);
  assert.equal(logs.length, 1);
  assert.equal((logs[0] as Record<string, unknown>).outcome, "unexpected_error");
  assert.equal((logs[0] as Record<string, unknown>).providerErrorKind, undefined);
  runtime = { enabled: false, apiKeyConfigured: false };
});

test("planner diagnostics: disabled by default (NOA_DEBUG_ROUTING not set to \"1\")", async (t) => {
  const logs: unknown[] = [];
  const originalInfo = console.info;
  const originalEnv = process.env.NOA_DEBUG_ROUTING;
  console.info = (...args: unknown[]) => { if (args[0] === "[NOA_PLANNER_DIAG]") logs.push(args); };
  delete process.env.NOA_DEBUG_ROUTING;
  t.after(() => { console.info = originalInfo; if (originalEnv === undefined) delete process.env.NOA_DEBUG_ROUTING; else process.env.NOA_DEBUG_ROUTING = originalEnv; });

  runtime = { enabled: true, apiKeyConfigured: true, provider: "openai", model: "gpt-4.1-mini", source: { provider: "registry_default", model: "registry_default" } } as never;
  providerReply = async () => ({ text: JSON.stringify({ kind: "passthrough", sourceResultSetHandle: null, relation: null, status: null, ordinal: null }) });
  const input = buildNoaPlannerInput(stateWith(quotationList()), { message: "x" });
  await requestNoaSemanticPlan(input);
  assert.equal(logs.length, 0);

  process.env.NOA_DEBUG_ROUTING = "true"; // any value other than exactly "1" stays disabled
  await requestNoaSemanticPlan(input);
  assert.equal(logs.length, 0);
  runtime = { enabled: false, apiKeyConfigured: false };
});

test("planner diagnostic entries contain no prompt, planner input, handles, user text or secrets", async (t) => {
  const logs: unknown[] = [];
  const originalInfo = console.info;
  const originalEnv = process.env.NOA_DEBUG_ROUTING;
  console.info = (...args: unknown[]) => { if (args[0] === "[NOA_PLANNER_DIAG]") logs.push(args[1] as string); };
  process.env.NOA_DEBUG_ROUTING = "1";
  t.after(() => { console.info = originalInfo; if (originalEnv === undefined) delete process.env.NOA_DEBUG_ROUTING; else process.env.NOA_DEBUG_ROUTING = originalEnv; });

  const state = stateWith(aggregate(), quotationList());
  const secretMessage = "sensitive user text about secret-marker QN-1234";
  runtime = { enabled: true, apiKeyConfigured: true, provider: "openai", model: "gpt-4.1-mini", source: { provider: "registry_default", model: "registry_default" } } as never;
  providerReply = async () => ({ text: JSON.stringify({ kind: "relation", sourceResultSetHandle: state.resultSets[1].handle, relation: "quotation.project_file", status: null, ordinal: null }) });
  const input = buildNoaPlannerInput(state, { message: secretMessage });
  await requestNoaSemanticPlan(input);
  assert.equal(logs.length, 1);
  const json = logs[0] as string;
  for (const leak of [secretMessage, "secret-marker", "QN-1234", state.resultSets[0].handle, state.resultSets[1].handle, "rs_", "sourceResultSetHandle", "userContent", "systemInstructions", "PLANNER_INSTRUCTIONS"]) {
    assert.ok(!json.includes(leak), leak);
  }
  const allowedKeys = new Set(["provider", "model", "runtimeEnabled", "apiKeyConfigured", "providerSource", "modelSource", "timeoutMs", "outcome", "durationMs", "providerErrorKind"]);
  for (const key of Object.keys(JSON.parse(json))) assert.ok(allowedKeys.has(key), key);
  runtime = { enabled: false, apiKeyConfigured: false };
});
