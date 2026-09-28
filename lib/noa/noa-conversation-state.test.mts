import assert from "node:assert/strict";
import test from "node:test";
import {
  appendNoaResultSet, clearNoaPendingChoice, clearNoaPendingSlot, createEmptyNoaConversationState, isNoaConversationState,
  isNoaPendingChoice, isNoaPendingSlot, MAX_NOA_PENDING_CHOICES, parseNoaConversationState,
  resolveNoaPendingChoice, setNoaPendingChoice, setNoaPendingSlot,
} from "./noa-conversation-state";
import {
  createNoaResultSetHandle, isNoaQuerySpec, isNoaResultSet, isNoaResultSetHandle,
  MAX_NOA_RESULT_SET_ITEMS, MAX_NOA_RESULT_SETS, MAX_NOA_STATE_JSON_LENGTH,
  type NoaAggregateResultSet, type NoaResultSet,
} from "./noa-result-set";

const createdAt = "2026-09-28T08:00:00.000Z";
const quotationId = "11111111-1111-4111-8111-111111111111";
const entity = (): NoaResultSet => ({
  handle: createNoaResultSetHandle(), kind: "entity", entityType: "quotation", count: 1,
  items: [{ id: quotationId }], createdAt,
});
const list = (size = 2): NoaResultSet => ({
  handle: createNoaResultSetHandle(), kind: "list", entityType: "project_file", count: size,
  items: Array.from({ length: size }, (_, i) => ({ orderNo: `CO-${String(i + 1).padStart(4, "0")}-001` })),
  querySpec: { capability: "project", operation: "list", filters: { status: "active" } }, createdAt,
});
const aggregate = (): NoaAggregateResultSet => ({
  handle: createNoaResultSetHandle(), kind: "aggregate", entityType: "quotation", count: 5,
  querySpec: { capability: "quotation", operation: "status_summary", filters: {} },
  groups: [{ status: "sent_to_client", count: 1 }, { status: "draft", count: 2 }, { status: "client_confirmed", count: 2 }], createdAt,
});
const choice = () => ({ id: quotationId, options: ["attention", "changes_today", "my_activity", "project_status"], createdAt });
const slot = () => ({ tool: "quotation", field: "quotation_id", createdAt });

test("Phase 1A: valid empty state is fresh and independently schema-versioned", () => {
  const state = createEmptyNoaConversationState();
  assert.deepEqual(state, { schemaVersion: 1, resultSets: [], focus: null });
  assert.equal(isNoaConversationState(state), true);
  assert.notEqual(createEmptyNoaConversationState().resultSets, state.resultSets);
  assert.equal(isNoaConversationState({ ...state, version: 7 }), false); // DB counter cannot leak into state
});

test("Phase 1A: unsupported schema versions and malformed JSON are rejected, never silently trusted", () => {
  for (const schemaVersion of [undefined, null, 0, 2, "1", NaN]) {
    assert.equal(isNoaConversationState({ ...createEmptyNoaConversationState(), schemaVersion }), false);
  }
  for (const raw of ["{", "null", "[]", "true", "1", '"state"', '{"schemaVersion":2}', " ".repeat(MAX_NOA_STATE_JSON_LENGTH + 1)]) {
    assert.equal(parseNoaConversationState(raw), null);
  }
  for (const value of [null, undefined, [], new Date(), {}, { schemaVersion: 1 }, { schemaVersion: 1, resultSets: [], focus: undefined }]) {
    assert.equal(isNoaConversationState(value), false);
  }
  assert.deepEqual(parseNoaConversationState(JSON.stringify(createEmptyNoaConversationState())), createEmptyNoaConversationState());
});

test("Phase 1A: ResultSet count cap and duplicate handles are enforced", () => {
  const resultSets = Array.from({ length: MAX_NOA_RESULT_SETS }, entity);
  const state = { ...createEmptyNoaConversationState(), resultSets };
  assert.equal(isNoaConversationState(state), true);
  assert.equal(isNoaConversationState({ ...state, resultSets: [...resultSets, entity()] }), false);
  assert.equal(isNoaConversationState({ ...state, resultSets: [resultSets[0], resultSets[0]] }), false);
  assert.equal(isNoaConversationState({ ...state, resultSets: new Array(1) }), false);
});

test("Phase 1A: item count is capped at 50; total matching count can exceed the stored prefix", () => {
  const capped = list(MAX_NOA_RESULT_SET_ITEMS);
  assert.equal(isNoaResultSet(capped), true);
  assert.equal(isNoaResultSet({ ...capped, count: 90 }), true);
  assert.equal(isNoaResultSet(list(MAX_NOA_RESULT_SET_ITEMS + 1)), false);
  assert.equal(isNoaResultSet({ ...capped, items: new Array(1) }), false);
  assert.equal(isNoaResultSet(list(0)), true);
  assert.equal(isNoaResultSet({ ...list(0), count: 1 }), false);
});

test("Phase 1A: entity sets permit only the matching stable identifier and exactly one item", () => {
  assert.equal(isNoaResultSet(entity()), true);
  const project = { ...entity(), entityType: "project_file", items: [{ orderNo: "CO-0003-001" }] };
  assert.equal(isNoaResultSet(project), true);
  for (const invalid of [
    { ...entity(), items: [{ id: "Quotation title" }] },
    { ...entity(), items: [{ orderNo: "CO-0003-001" }] },
    { ...entity(), items: [] }, { ...entity(), count: 2 },
    { ...project, items: [{ orderNo: "Fixture project" }] },
    { ...project, items: [{ orderNo: "CO-" + "1".repeat(65) }] },
    { ...project, items: [{ id: quotationId }] },
  ]) assert.equal(isNoaResultSet(invalid), false);
});

test("Phase 1A: lists preserve the displayed order across append and JSON reload", () => {
  const result = list(3);
  assert.ok(result.kind === "list");
  result.items.reverse();
  const state = appendNoaResultSet(createEmptyNoaConversationState(), result);
  assert.deepEqual(parseNoaConversationState(JSON.stringify(state))?.resultSets[0], result);
  assert.deepEqual(state.focus, { resultSetHandle: result.handle });
  result.items.reverse(); // caller mutations must not change stored ordinal meaning
  assert.notDeepEqual(state.resultSets[0], result);
});

test("Phase 1A: quotation list query is closed and compatible with the list entity type", () => {
  const result = { ...entity(), kind: "list", querySpec: { capability: "quotation", operation: "status_list", filters: { status: "client_confirmed" } } };
  assert.equal(isNoaResultSet(result), true);
  assert.equal(isNoaResultSet({ ...result, querySpec: aggregate().querySpec }), false);
  assert.equal(isNoaResultSet({ ...list(), querySpec: result.querySpec }), false);
});

test("Phase 1A: aggregate retains only safe status groups/counts and drill-down query scope", () => {
  const result = aggregate();
  assert.equal(isNoaResultSet(result), true);
  assert.deepEqual(result.groups.map(({ status }) => status), ["sent_to_client", "draft", "client_confirmed"]);
  assert.equal(isNoaResultSet({ ...result, querySpec: { ...result.querySpec, filters: { status: "client_confirmed" } }, groups: [{ status: "client_confirmed", count: 2 }], count: 2 }), true);
  assert.equal(isNoaResultSet({ ...result, groups: [], count: 0 }), true);
  assert.equal(isNoaResultSet({ ...result, count: 6 }), false);
  assert.equal(isNoaResultSet({ ...result, groups: [{ status: "draft", count: 2 }, { status: "draft", count: 3 }] }), false);
  assert.equal(isNoaResultSet({ ...result, querySpec: { ...result.querySpec, filters: { status: "client_confirmed" } } }), false);
  assert.equal(isNoaResultSet({ ...result, groups: new Array(1) }), false);
  assert.equal(isNoaResultSet({ ...result, groups: [{ status: "anything", count: 5 }] }), false);
  assert.equal(isNoaResultSet({ ...result, items: [{ id: quotationId }] }), false);
});

test("Phase 1A: unsupported kinds, entity types, identifiers, timestamps and counts are rejected", () => {
  for (const override of [
    { kind: "graph" }, { entityType: "client" }, { handle: "rs_CO-0003-001" }, { handle: "rs_" + "a".repeat(33) },
    { createdAt: "2026-02-30T08:00:00.000Z" }, { createdAt: "today" },
    { count: -1 }, { count: NaN }, { count: Infinity }, { count: 0.5 }, { count: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.equal(isNoaResultSet({ ...entity(), ...override }), false);
  assert.equal(isNoaResultSet({ ...list(2), items: [{ orderNo: "CO-0003-001" }, { orderNo: "CO-0003-001" }] }), false);
});

test("Phase 1A: generated handles have 128 opaque random bits and do not use item indexes", () => {
  const handles = Array.from({ length: 256 }, createNoaResultSetHandle);
  assert.equal(new Set(handles).size, handles.length);
  assert.ok(handles.every(isNoaResultSetHandle));
  assert.ok(handles.every((handle) => /^rs_[0-9a-f]{32}$/.test(handle)));
  for (const handle of ["rs_0", "rs_1", "rs_" + quotationId, "CO-0003-001", quotationId]) assert.equal(isNoaResultSetHandle(handle), false);
});

test("Phase 1A: querySpec accepts only pilot operations, statuses and filter keys", () => {
  assert.equal(isNoaQuerySpec(aggregate().querySpec), true);
  for (const query of [
    "select * from quotations", { sql: "select 1" },
    { capability: "quotation", operation: "status_summary", filters: { sql: "true" } },
    { capability: "quotation", operation: "status_summary", filters: { clientName: "Example" } },
    { capability: "quotation", operation: "status_summary", filters: { status: "waiting" } },
    { capability: "quotation", operation: "delete", filters: {} },
    { capability: "client", operation: "list", filters: {} },
    { capability: "project", operation: "list", filters: { status: "client_confirmed" } },
    { capability: "quotation", operation: "status_summary", filters: null },
    { ...aggregate().querySpec, prompt: "find them" },
  ]) assert.equal(isNoaQuerySpec(query), false);
});

test("Phase 1A: pendingChoice has bounded unique tokens without labels or natural-language commands", () => {
  assert.equal(isNoaPendingChoice(choice()), true);
  assert.equal(isNoaConversationState({ ...createEmptyNoaConversationState(), pendingChoice: choice() }), true);
  assert.equal(isNoaPendingChoice({ ...choice(), options: Array(MAX_NOA_PENDING_CHOICES + 1).fill("attention") }), false);
  for (const options of [[], ["attention", "attention"], ["list all quotations"], [{ id: "attention", label: "Attention" }], new Array(1)]) {
    assert.equal(isNoaPendingChoice({ ...choice(), options }), false);
  }
  assert.equal(isNoaPendingChoice({ ...choice(), id: "unbounded".repeat(100) }), false);
});

test("Phase 1A: pendingSlot restricts deterministic tool/field combinations", () => {
  assert.equal(isNoaPendingSlot(slot()), true);
  assert.equal(isNoaPendingSlot({ ...slot(), tool: "project", field: "project_file_number" }), true);
  assert.equal(isNoaConversationState({ ...createEmptyNoaConversationState(), pendingSlot: slot() }), true);
  for (const override of [{ field: "project_file_number" }, { tool: "sql" }, { field: "amount" }, { createdAt: "yesterday" }, { prompt: "Which?" }]) {
    assert.equal(isNoaPendingSlot({ ...slot(), ...override }), false);
  }
});

test("Phase 1A: activeTask reserves only a discriminator, not configuration state", () => {
  const state = { ...createEmptyNoaConversationState(), activeTask: { kind: "product_configuration" } };
  assert.equal(isNoaConversationState(state), true);
  assert.equal(isNoaConversationState({ ...state, activeTask: { kind: "product_configuration", selections: {} } }), false);
  assert.equal(isNoaConversationState({ ...state, activeTask: { kind: "planner" } }), false);
});

test("Phase 1A: focus must refer to a retained set; stack evicts oldest and never mutates caller state", () => {
  let state = createEmptyNoaConversationState();
  const original = structuredClone(state);
  const results = Array.from({ length: MAX_NOA_RESULT_SETS + 1 }, entity);
  for (const result of results) state = appendNoaResultSet(state, result);
  assert.deepEqual(state.resultSets.map(({ handle }) => handle), results.slice(1).map(({ handle }) => handle));
  assert.equal(state.focus?.resultSetHandle, results.at(-1)?.handle);
  assert.equal(isNoaConversationState(state), true);
  assert.deepEqual(original, createEmptyNoaConversationState());
  assert.equal(isNoaConversationState({ ...state, focus: { resultSetHandle: results[0].handle } }), false);
  assert.equal(isNoaConversationState({ ...state, focus: { resultSetHandle: results[1].handle, entityHandle: quotationId } }), false);
  assert.throws(() => appendNoaResultSet(state, results[1]), /Duplicate/);
  assert.throws(() => appendNoaResultSet(state, { ...entity(), count: 2 } as NoaResultSet), /Invalid/);
});

test("Phase 1A: unexpected transcript, business and provider fields are rejected at every boundary", () => {
  for (const extra of [{ recentMessages: [] }, { clientName: "Example" }, { total: 100 }, { prompt: "Plan" }, { modelResponse: {} }]) {
    assert.equal(isNoaConversationState({ ...createEmptyNoaConversationState(), ...extra }), false);
    assert.equal(isNoaResultSet({ ...entity(), ...extra }), false);
    assert.equal(isNoaResultSet({ ...entity(), items: [{ id: quotationId, ...extra }] }), false);
    assert.equal(isNoaPendingChoice({ ...choice(), ...extra }), false);
    assert.equal(isNoaPendingSlot({ ...slot(), ...extra }), false);
  }
  assert.equal(parseNoaConversationState('{"schemaVersion":1,"resultSets":[],"focus":null,"__proto__":{}}'), null);
});

// ── Phase 1D PART 7: push (reuses appendNoaResultSet - see its own comment) ────────────────────

test("21-24. pushing a new ResultSet preserves prior sets, focuses the newest, drops the oldest past 5, and always yields a state passing Phase 1A validation", () => {
  let state = createEmptyNoaConversationState();
  const sets = Array.from({ length: 6 }, () => entity());
  for (const set of sets) state = appendNoaResultSet(state, set);
  assert.equal(state.resultSets.length, MAX_NOA_RESULT_SETS);
  assert.deepEqual(state.resultSets, sets.slice(1)); // oldest (sets[0]) dropped
  assert.equal(state.focus?.resultSetHandle, sets.at(-1)!.handle);
  assert.ok(state.resultSets.every((set) => sets.slice(1).some((s) => s.handle === set.handle))); // 21: priors preserved
  assert.equal(isNoaConversationState(state), true); // 24
});

// ── Phase 1D PART 10: pendingChoice ─────────────────────────────────────────────────────────────

test("25. pendingChoice is bounded, exactly resolved, and clears cleanly", () => {
  const withChoice = setNoaPendingChoice(createEmptyNoaConversationState(), ["attention", "project_status"]);
  assert.ok(isNoaPendingChoice(withChoice.pendingChoice));
  assert.equal(isNoaConversationState(withChoice), true);
  assert.equal(resolveNoaPendingChoice(withChoice, "attention"), "attention");
  assert.equal(resolveNoaPendingChoice(withChoice, "changes_today"), null); // offered, but not by THIS choice
  assert.equal(resolveNoaPendingChoice(withChoice, "not-a-real-option"), null);
  assert.equal(resolveNoaPendingChoice(withChoice, 42), null);
  assert.equal(resolveNoaPendingChoice(createEmptyNoaConversationState(), "attention"), null);
  // Bounded: 5 raw options exceeds MAX_NOA_PENDING_CHOICES (4) even before dedup is considered.
  assert.throws(() => setNoaPendingChoice(createEmptyNoaConversationState(),
    ["attention", "changes_today", "my_activity", "project_status", "attention"]), /Invalid/);
  // Duplicate options within bounds are still rejected.
  assert.throws(() => setNoaPendingChoice(createEmptyNoaConversationState(), ["attention", "attention"]), /Invalid/);
  const cleared = clearNoaPendingChoice(withChoice);
  assert.equal(cleared.pendingChoice, undefined);
  assert.equal(isNoaConversationState(cleared), true);
});

// ── Phase 1D PART 11: pendingSlot one-turn expiry / explicit fulfillment consumption ────────────

test("26. pendingSlot exists after being set, and the SAME clear operation serves both fulfillment consumption and one-turn expiry", () => {
  const turnN = setNoaPendingSlot(createEmptyNoaConversationState(), { tool: "project", field: "project_file_number" });
  assert.ok(isNoaPendingSlot(turnN.pendingSlot));
  assert.equal(isNoaConversationState(turnN), true);

  // Turn N+1, unrelated/unanswered: caller expires it unconditionally.
  const expired = clearNoaPendingSlot(turnN);
  assert.equal(expired.pendingSlot, undefined);

  // Turn N+1, explicitly fulfilled: caller has already consumed turnN.pendingSlot's fields
  // elsewhere, then clears it the same way.
  assert.equal(turnN.pendingSlot?.tool, "project");
  const consumed = clearNoaPendingSlot(turnN);
  assert.equal(consumed.pendingSlot, undefined);
  assert.equal(isNoaConversationState(consumed), true);
});
