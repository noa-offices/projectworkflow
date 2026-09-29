// Phase 1D: relation registry + deterministic relation/drill-down execution. No live Supabase -
// `@/lib/supabase/server` is a small fake scoped to exactly the chains these files issue, same
// convention as noa-session.test.mts. `@/lib/auth`'s real requireQuotationActionUser() runs for
// real against the fake client, so the auth gate itself is genuinely exercised.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { appendNoaResultSet, createEmptyNoaConversationState } from "./noa-conversation-state";
import { createNoaResultSetHandle, MAX_NOA_RESULT_SET_ITEMS, type NoaResultSet } from "./noa-result-set";
import { NOA_RELATIONS, validateNoaRelationSource } from "./noa-relation-registry";
import { NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS } from "./testing/noa-golden-fixtures";

mock.module("server-only", { defaultExport: {} });

type Row = Record<string, unknown>;
const PROFILE = { id: "user-1", account_status: "active", role: "sales_designer", email: "u@example.com", full_name: null };
let currentUserId: string | null = "user-1";
let quotationRows: Row[] = [];
let quotationsError: { message: string } | null = null;

function applyFilters(rows: Row[], filters: Array<["eq" | "in", string, unknown]>) {
  return rows.filter((row) => filters.every(([op, key, value]) =>
    op === "eq" ? row[key] === value : Array.isArray(value) && value.includes(row[key])));
}

function createFakeSupabaseClient() {
  return {
    auth: { getUser: async () => ({ data: { user: currentUserId ? { id: currentUserId, user_metadata: {} } : null } }) },
    from(table: string) {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ async single() { return { data: currentUserId ? PROFILE : null, error: null }; } }) }) };
      }
      assert.equal(table, "quotations");
      const filters: Array<["eq" | "in", string, unknown]> = [];
      let orderBy: string | null = null;
      let limitTo: number | null = null;
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => { filters.push(["eq", key, value]); return builder; },
        in: (key: string, value: unknown) => { filters.push(["in", key, value]); return builder; },
        order: (key: string) => { orderBy = key; return builder; },
        limit: (n: number) => { limitTo = n; return builder; },
        returns: () => builder,
        then(resolve: (v: unknown) => void) {
          if (quotationsError) return resolve({ data: null, error: quotationsError });
          let rows = applyFilters(quotationRows, filters);
          if (orderBy) rows = [...rows].sort((a, b) => String(b[orderBy!]).localeCompare(String(a[orderBy!])));
          if (limitTo !== null) rows = rows.slice(0, limitTo);
          resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  };
}
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => createFakeSupabaseClient() } });

const { resolveNoaRelation, drillDownNoaAggregate } = await import("./noa-relation.server");

function reset() {
  currentUserId = "user-1";
  quotationRows = [];
  quotationsError = null;
}

function layoutSettingsWithProjectFile(orderNo: string): unknown {
  return { projectFile: {
    orderNo, quotationId: "q", quotationNo: `QN-${orderNo}`, clientId: "client-1", clientName: "Fixture Client",
    reference: orderNo, total: 1000, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", createdBy: "user-1",
  } };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function quotationEntity(id: string): NoaResultSet {
  return { handle: createNoaResultSetHandle(), createdAt: "2026-01-01T00:00:00.000Z", kind: "entity", entityType: "quotation", count: 1, items: [{ id }] };
}
function quotationList(ids: string[]): NoaResultSet {
  return { handle: createNoaResultSetHandle(), createdAt: "2026-01-01T00:00:00.000Z", kind: "list", entityType: "quotation", count: ids.length, items: ids.map((id) => ({ id })) };
}
function quotationAggregate(groups: Array<{ status: "draft" | "sent_to_client" | "client_confirmed"; count: number }>): NoaResultSet {
  return {
    handle: createNoaResultSetHandle(), createdAt: "2026-01-01T00:00:00.000Z", kind: "aggregate", entityType: "quotation",
    count: groups.reduce((sum, g) => sum + g.count, 0),
    querySpec: { capability: "quotation", operation: "status_summary", filters: {} },
    groups,
  };
}

// ── PART 14: RELATION REGISTRY (1-5) ────────────────────────────────────────────────────────────

test("1. quotation -> project_file is registered with the closed contract shape", () => {
  const relation = NOA_RELATIONS["quotation.project_file"];
  assert.deepEqual(relation, { id: "quotation.project_file", sourceType: "quotation", targetType: "project_file", allowedSourceKinds: ["entity", "list"] });
  assert.deepEqual(Object.keys(NOA_RELATIONS).sort(), ["client.project_file", "client.quotation", "quotation.project_file"]); // closed: nothing else registered
});

test("2. an unsupported relation id is rejected", () => {
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationEntity(uuid(1)));
  const result = validateNoaRelationSource(state, state.resultSets[0].handle, "project_file.quotation" as never);
  assert.deepEqual(result, { ok: false, reason: "unsupported_relation" });
});

test("3. wrong source entity type is rejected", () => {
  const projectList: NoaResultSet = { handle: createNoaResultSetHandle(), createdAt: "2026-01-01T00:00:00.000Z", kind: "list", entityType: "project_file", count: 1, items: [{ orderNo: "CO-0001-001" }] };
  const state = appendNoaResultSet(createEmptyNoaConversationState(), projectList);
  assert.deepEqual(validateNoaRelationSource(state, state.resultSets[0].handle, "quotation.project_file"), { ok: false, reason: "incompatible_source_type" });
});

test("4. an unsupported ResultSet kind (aggregate) is rejected", () => {
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationAggregate([{ status: "client_confirmed", count: 2 }]));
  assert.deepEqual(validateNoaRelationSource(state, state.resultSets[0].handle, "quotation.project_file"), { ok: false, reason: "incompatible_source_type" });
});

test("5. a missing/unknown handle is rejected", () => {
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationEntity(uuid(1)));
  assert.deepEqual(validateNoaRelationSource(state, "rs_00000000000000000000000000000000", "quotation.project_file"), { ok: false, reason: "result_set_not_found" });
});

// ── PART 15: RELATION EXECUTION (6-14) ──────────────────────────────────────────────────────────

test("6. one quotation -> one project entity ResultSet", async () => {
  reset();
  quotationRows = [{ id: uuid(1), layout_settings: layoutSettingsWithProjectFile("CO-0001-001") }];
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationEntity(uuid(1)));
  const result = await resolveNoaRelation(state, state.resultSets[0].handle, "quotation.project_file");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.resultSet.kind, "entity");
  assert.deepEqual(result.resultSet.kind === "entity" && result.resultSet.items, [{ orderNo: "CO-0001-001" }]);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.resultCount, 1);
});

test("7. two quotations with distinct targets -> two-item project list, first-appearance order", async () => {
  reset();
  quotationRows = [
    { id: uuid(1), layout_settings: layoutSettingsWithProjectFile("CO-0002-001") },
    { id: uuid(2), layout_settings: layoutSettingsWithProjectFile("CO-0001-001") },
  ];
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationList([uuid(1), uuid(2)]));
  const result = await resolveNoaRelation(state, state.resultSets[0].handle, "quotation.project_file");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.resultSet.kind, "list");
  assert.deepEqual(result.resultSet.kind === "list" && result.resultSet.items, [{ orderNo: "CO-0002-001" }, { orderNo: "CO-0001-001" }]);
  assert.equal(result.resultSet.count, 2);
});

test("8-9. Q1->P2, Q2->P1, Q3->P2: duplicate target deduplicated, display order is P2 then P1 (first appearance, never alphabetical/DB order)", async () => {
  reset();
  quotationRows = [
    { id: uuid(1), layout_settings: layoutSettingsWithProjectFile("CO-0002-001") }, // P2
    { id: uuid(2), layout_settings: layoutSettingsWithProjectFile("CO-0001-001") }, // P1
    { id: uuid(3), layout_settings: layoutSettingsWithProjectFile("CO-0002-001") }, // P2 again
  ];
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationList([uuid(1), uuid(2), uuid(3)]));
  const result = await resolveNoaRelation(state, state.resultSets[0].handle, "quotation.project_file");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.resultSet.kind === "list" && result.resultSet.items, [{ orderNo: "CO-0002-001" }, { orderNo: "CO-0001-001" }]);
  assert.equal(result.sourceCount, 3);
  assert.equal(result.matchedCount, 3); // all 3 source quotations resolved to SOME project file
  assert.equal(result.resultCount, 2); // but only 2 unique targets
});

test("10-11. a quotation with no linked Project File is never invented; zero matches yields a valid empty list, not an error", async () => {
  reset();
  quotationRows = [{ id: uuid(1), layout_settings: {} }]; // unconfirmed, no projectFile in layout_settings
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationEntity(uuid(1)));
  const result = await resolveNoaRelation(state, state.resultSets[0].handle, "quotation.project_file");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.resultSet.kind, "list");
  assert.deepEqual(result.resultSet.kind === "list" && result.resultSet.items, []);
  assert.equal(result.resultSet.count, 0);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.matchedCount, 0);
  assert.equal(result.resultCount, 0);
});

test("12. a stale/foreign source id cannot bypass authorized access - RLS-hidden rows are silently skipped, never invented", async () => {
  reset();
  quotationRows = []; // the fake RLS-scoped table simply has no row visible for this id
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationEntity(uuid(99)));
  const result = await resolveNoaRelation(state, state.resultSets[0].handle, "quotation.project_file");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.matchedCount, 0);
  assert.equal(result.resultCount, 0);
});

test("12b. an unauthenticated caller gets a closed unauthorized result, never a thrown redirect", async () => {
  reset();
  currentUserId = null;
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationEntity(uuid(1)));
  assert.deepEqual(await resolveNoaRelation(state, state.resultSets[0].handle, "quotation.project_file"), { ok: false, reason: "unauthorized" });
});

test("13. more than 50 distinct targets are bounded to MAX_NOA_RESULT_SET_ITEMS", async () => {
  reset();
  const ids = Array.from({ length: MAX_NOA_RESULT_SET_ITEMS }, (_, i) => uuid(i + 1));
  quotationRows = ids.map((id, i) => ({ id, layout_settings: layoutSettingsWithProjectFile(`CO-${String(i + 1).padStart(4, "0")}-001`) }));
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationList(ids));
  const result = await resolveNoaRelation(state, state.resultSets[0].handle, "quotation.project_file");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.ok(result.resultSet.count <= MAX_NOA_RESULT_SET_ITEMS);
  assert.equal(result.resultCount, MAX_NOA_RESULT_SET_ITEMS);
});

test("14. no name/price/prose ever appears in the returned ResultSet", async () => {
  reset();
  quotationRows = [{ id: uuid(1), layout_settings: layoutSettingsWithProjectFile("CO-0001-001") }];
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationEntity(uuid(1)));
  const result = await resolveNoaRelation(state, state.resultSets[0].handle, "quotation.project_file");
  assert.ok(result.ok);
  assert.doesNotMatch(JSON.stringify(result.ok && result.resultSet), /Fixture Client|1000|USD|2026-01-01/);
});

test("storage error on the underlying read maps to a closed error, never a raw message", async () => {
  reset();
  quotationsError = { message: "connection refused" };
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationEntity(uuid(1)));
  const result = await resolveNoaRelation(state, state.resultSets[0].handle, "quotation.project_file");
  assert.deepEqual(result, { ok: false, reason: "storage_error" });
});

// ── PART 16: AGGREGATE DRILL-DOWN (15-20) ───────────────────────────────────────────────────────

test("15/20. aggregate + client_confirmed -> a valid quotation list ResultSet of the matching authoritative rows", async () => {
  reset();
  quotationRows = [
    { id: uuid(1), status: "client_confirmed", created_at: "2026-01-02T00:00:00.000Z" },
    { id: uuid(2), status: "client_confirmed", created_at: "2026-01-01T00:00:00.000Z" },
    { id: uuid(3), status: "draft", created_at: "2026-01-03T00:00:00.000Z" },
  ];
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationAggregate([{ status: "draft", count: 1 }, { status: "client_confirmed", count: 2 }]));
  const result = await drillDownNoaAggregate(state, state.resultSets[0].handle, "client_confirmed");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.resultSet.kind, "list");
  assert.equal(result.resultSet.entityType, "quotation");
  assert.deepEqual(result.resultSet.kind === "list" && result.resultSet.items, [{ id: uuid(1) }, { id: uuid(2) }]);
  assert.equal(result.resultSet.count, 2);
});

test("16. the status filter is a closed enum value, never free text", async () => {
  reset();
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationAggregate([{ status: "draft", count: 1 }]));
  assert.deepEqual(await drillDownNoaAggregate(state, state.resultSets[0].handle, "not_a_real_status" as never), { ok: false, reason: "incompatible_source_type" });
});

test("17. an unsupported source (non-aggregate, or a status the aggregate never covered) is rejected", async () => {
  reset();
  const listState = appendNoaResultSet(createEmptyNoaConversationState(), quotationList([uuid(1)]));
  assert.deepEqual(await drillDownNoaAggregate(listState, listState.resultSets[0].handle, "draft"), { ok: false, reason: "incompatible_source_type" });
  const aggState = appendNoaResultSet(createEmptyNoaConversationState(), quotationAggregate([{ status: "draft", count: 1 }]));
  assert.deepEqual(await drillDownNoaAggregate(aggState, aggState.resultSets[0].handle, "client_confirmed"), { ok: false, reason: "incompatible_source_type" });
});

test("18. rows are re-fetched authoritatively - the aggregate's own stored counts are never trusted as the result", async () => {
  reset();
  // Aggregate claims 5 client_confirmed, but the live/authorized table only has 1 visible now.
  quotationRows = [{ id: uuid(1), status: "client_confirmed", created_at: "2026-01-01T00:00:00.000Z" }];
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationAggregate([{ status: "client_confirmed", count: 5 }]));
  const result = await drillDownNoaAggregate(state, state.resultSets[0].handle, "client_confirmed");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.resultSet.count, 1); // authoritative, not the stale 5
});

test("19. display order is stable (most-recent-first, matching the existing capability's own ordering)", async () => {
  reset();
  quotationRows = [
    { id: uuid(1), status: "draft", created_at: "2026-01-01T00:00:00.000Z" },
    { id: uuid(2), status: "draft", created_at: "2026-01-03T00:00:00.000Z" },
    { id: uuid(3), status: "draft", created_at: "2026-01-02T00:00:00.000Z" },
  ];
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationAggregate([{ status: "draft", count: 3 }]));
  const first = await drillDownNoaAggregate(state, state.resultSets[0].handle, "draft");
  const second = await drillDownNoaAggregate(state, state.resultSets[0].handle, "draft");
  assert.ok(first.ok && second.ok);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.resultSet.kind === "list" && first.resultSet.items, [{ id: uuid(2) }, { id: uuid(3) }, { id: uuid(1) }]);
  assert.deepEqual(first.resultSet.kind === "list" && first.resultSet.items, second.resultSet.kind === "list" && second.resultSet.items);
});

// ── State composition: relation/drill-down output can be pushed with the existing operation ────

test("resolveNoaRelation's output can be pushed onto state with appendNoaResultSet and becomes focus", async () => {
  reset();
  quotationRows = [{ id: uuid(1), layout_settings: layoutSettingsWithProjectFile("CO-0001-001") }];
  let state = appendNoaResultSet(createEmptyNoaConversationState(), quotationEntity(uuid(1)));
  const sourceHandle = state.resultSets[0].handle;
  const result = await resolveNoaRelation(state, sourceHandle, "quotation.project_file");
  assert.ok(result.ok);
  if (!result.ok) return;
  state = appendNoaResultSet(state, result.resultSet);
  assert.equal(state.resultSets.length, 2);
  assert.equal(state.resultSets[0].handle, sourceHandle); // previous set preserved
  assert.equal(state.focus?.resultSetHandle, result.resultSet.handle); // newest becomes focus
});

// ── Phase 1E PART 8: Case D proof - the deterministic relation service, called directly on the
// SAME two client-confirmed quotations Case D's shadow capture holds, resolves the correct
// Project ResultSet (CO-0003-001, CO-0004-001) - even though authoritative routing (unchanged,
// see noa-golden-conversations.test.mts's own CASE D) still runs a generic Project query instead.
// This is evidence the service is structurally ready for Phase 2's Planner, not a routing change.
test("Phase 1E: Case D's two client-confirmed golden quotations resolve to their real linked Project Files via the relation service", async () => {
  reset();
  quotationRows = NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS.map((q) => ({ id: q.id, layout_settings: layoutSettingsWithProjectFile(q.projectOrderNo!) }));
  const state = appendNoaResultSet(createEmptyNoaConversationState(), quotationList(NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS.map((q) => q.id)));
  const result = await resolveNoaRelation(state, state.resultSets[0].handle, "quotation.project_file");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.resultSet.kind, "list");
  assert.deepEqual(result.resultSet.kind === "list" && result.resultSet.items,
    NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS.map((q) => ({ orderNo: q.projectOrderNo })));
});
