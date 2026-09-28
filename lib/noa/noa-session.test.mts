// Phase 1B: focused repository tests. No live Supabase - `@/lib/supabase/server` is replaced with
// a small in-memory fake scoped to exactly the chains noa-session.server.ts issues (select/insert/
// update with .eq()/.gt() filters and .select().single()/.maybeSingle()), following the same
// mock.module() convention as lib/noa/noa-chat-route.test.mts. Not a generic fake-DB framework.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createEmptyNoaConversationState, type NoaConversationState } from "./noa-conversation-state";
import { NOA_SESSION_IDLE_EXPIRY_MINUTES } from "./noa-result-set";
import { createNoaResultSetHandle } from "./noa-result-set";

mock.module("server-only", { defaultExport: {} });

type FakeRow = { id: string; user_id: string; version: number; state: unknown; expires_at: string; created_at: string };

const PROFILE = { account_status: "active", avatar_url: null, department: null, email: "user@example.com", full_name: "Fixture User", id: "user-1", job_title: null, phone: null, role: "sales" };
const FOREIGN_PROFILE = { ...PROFILE, id: "user-2" };

let currentUserId: string | null = "user-1";
let rows: FakeRow[] = [];
let nextRowId = 1;
let insertShouldError = false;
let updateShouldError = false;

function matches(row: FakeRow, filters: Array<[string, "eq" | "gt", unknown]>): boolean {
  return filters.every(([key, op, value]) => {
    const actual = (row as unknown as Record<string, unknown>)[key];
    return op === "eq" ? actual === value : (actual as string) > (value as string);
  });
}

function selectShape(row: FakeRow) {
  return { id: row.id, state: row.state, version: row.version };
}

function createFakeSupabaseClient() {
  return {
    auth: { getUser: async () => ({ data: { user: currentUserId ? { id: currentUserId } : null } }) },
    from(table: string) {
      if (table === "profiles") {
        return { select: () => ({ eq: (_k: string, id: string) => ({
          async single() {
            const profile = [PROFILE, FOREIGN_PROFILE].find((p) => p.id === id);
            return profile ? { data: profile, error: null } : { data: null, error: { message: "not found" } };
          },
        }) }) };
      }
      assert.equal(table, "noa_sessions");
      return {
        insert(payload: Partial<FakeRow>) {
          return {
            select: () => ({
              async single() {
                if (insertShouldError) return { data: null, error: { message: "insert failed" } };
                const row: FakeRow = {
                  created_at: new Date().toISOString(),
                  expires_at: payload.expires_at as string,
                  id: `session-${nextRowId++}`,
                  state: payload.state,
                  user_id: payload.user_id as string,
                  version: 0,
                };
                rows.push(row);
                return { data: selectShape(row), error: null };
              },
            }),
          };
        },
        select() {
          const filters: Array<[string, "eq" | "gt", unknown]> = [];
          const builder = {
            eq(key: string, value: unknown) { filters.push([key, "eq", value]); return builder; },
            gt(key: string, value: unknown) { filters.push([key, "gt", value]); return builder; },
            async maybeSingle() {
              const row = rows.find((candidate) => matches(candidate, filters));
              return { data: row ? selectShape(row) : null, error: null };
            },
          };
          return builder;
        },
        update(payload: Partial<FakeRow>) {
          const filters: Array<[string, "eq" | "gt", unknown]> = [];
          let applied = false;
          function apply(): FakeRow | null {
            if (applied) return rows.find((candidate) => candidate.id === appliedId) ?? null;
            const row = rows.find((candidate) => matches(candidate, filters));
            if (!row || updateShouldError) return null;
            Object.assign(row, payload);
            applied = true;
            appliedId = row.id;
            return row;
          }
          let appliedId: string | undefined;
          const builder = {
            eq(key: string, value: unknown) { filters.push([key, "eq", value]); return builder; },
            gt(key: string, value: unknown) { filters.push([key, "gt", value]); return builder; },
            select: () => ({
              async maybeSingle() {
                if (updateShouldError) return { data: null, error: { message: "update failed" } };
                const row = apply();
                return { data: row ? selectShape(row) : null, error: null };
              },
            }),
            // Best-effort expiry refresh awaits the eq() chain directly, with no .select().
            then(resolve: (value: unknown) => void) {
              if (!updateShouldError) apply();
              resolve({ data: null, error: updateShouldError ? { message: "update failed" } : null });
            },
          };
          return builder;
        },
      };
    },
  };
}

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => createFakeSupabaseClient() } });

const { loadOrCreateNoaSession, refreshNoaSessionExpiry, saveNoaSession } = await import("./noa-session.server");

function reset() {
  currentUserId = "user-1";
  rows = [];
  nextRowId = 1;
  insertShouldError = false;
  updateShouldError = false;
}

function seedRow(overrides: Partial<FakeRow> = {}): FakeRow {
  const row: FakeRow = {
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    id: `session-${nextRowId++}`,
    state: createEmptyNoaConversationState(),
    user_id: "user-1",
    version: 0,
    ...overrides,
  };
  rows.push(row);
  return row;
}

const nonEmptyState = (): NoaConversationState => ({
  focus: null,
  resultSets: [{ count: 1, createdAt: "2026-01-01T00:00:00.000Z", entityType: "quotation", handle: createNoaResultSetHandle(), items: [{ id: "11111111-1111-4111-8111-111111111111" }], kind: "entity" }],
  schemaVersion: 1,
});

// ── LOAD / CREATE ────────────────────────────────────────────────────────────

test("1. missing session creates a valid empty state", async () => {
  reset();
  const result = await loadOrCreateNoaSession();
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.session.state, createEmptyNoaConversationState());
  assert.equal(result.session.version, 0);
});

test("2. created session gets a 30-minute expiry", async () => {
  reset();
  const before = Date.now();
  await loadOrCreateNoaSession();
  const row = rows[0];
  const expiryMinutes = (new Date(row.expires_at).getTime() - before) / 60_000;
  assert.ok(Math.abs(expiryMinutes - NOA_SESSION_IDLE_EXPIRY_MINUTES) < 1);
});

test("3. a valid existing session loads", async () => {
  reset();
  const seeded = seedRow({ state: nonEmptyState(), version: 3 });
  const result = await loadOrCreateNoaSession(seeded.id);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.session.sessionId, seeded.id);
  assert.equal(result.session.version, 3);
  assert.deepEqual(result.session.state, seeded.state);
});

test("4. malformed stored state is rejected, never auto-repaired or trusted", async () => {
  reset();
  const seeded = seedRow({ state: { schemaVersion: 999, resultSets: [], focus: null } });
  const result = await loadOrCreateNoaSession(seeded.id);
  assert.deepEqual(result, { ok: false, reason: "invalid_state" });
  // Untouched: no silent repair/write happened on the read path.
  assert.deepEqual(rows[0].state, seeded.state);
});

test("5. unsupported state schema version is rejected the same way", async () => {
  reset();
  const seeded = seedRow({ state: { schemaVersion: 2, resultSets: [], focus: null } });
  const result = await loadOrCreateNoaSession(seeded.id);
  assert.deepEqual(result, { ok: false, reason: "invalid_state" });
});

// ── OWNERSHIP ────────────────────────────────────────────────────────────────

test("6. every query is scoped by the authenticated user, not a caller-supplied id", async () => {
  reset();
  const seeded = seedRow({ user_id: "user-2" });
  currentUserId = "user-1";
  const result = await loadOrCreateNoaSession(seeded.id);
  // Falls through to a fresh session of the CALLER's own - never the foreign row's data.
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.notEqual(result.session.sessionId, seeded.id);
  assert.deepEqual(result.session.state, createEmptyNoaConversationState());
});

test("7. a foreign user's session cannot be loaded even when its id is known", async () => {
  reset();
  const seeded = seedRow({ state: nonEmptyState(), user_id: "user-2" });
  currentUserId = "user-1";
  const result = await loadOrCreateNoaSession(seeded.id);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.notDeepEqual(result.session.state, seeded.state);
});

test("8. a foreign user's session cannot be saved", async () => {
  reset();
  const seeded = seedRow({ user_id: "user-2" });
  currentUserId = "user-1";
  const result = await saveNoaSession(seeded.id, seeded.version, nonEmptyState());
  assert.deepEqual(result, { ok: false, reason: "version_conflict" });
  assert.deepEqual(rows.find((row) => row.id === seeded.id)!.state, seeded.state);
});

// ── VERSIONING ───────────────────────────────────────────────────────────────

test("9. the correct expected version saves successfully", async () => {
  reset();
  const seeded = seedRow();
  const result = await saveNoaSession(seeded.id, 0, nonEmptyState());
  assert.ok(result.ok);
});

test("10. version increments exactly once per successful save", async () => {
  reset();
  const seeded = seedRow();
  const result = await saveNoaSession(seeded.id, 0, nonEmptyState());
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.version, 1);
  assert.equal(rows[0].version, 1);
});

test("11. a stale expected version returns version_conflict", async () => {
  reset();
  const seeded = seedRow({ version: 5 });
  const result = await saveNoaSession(seeded.id, 4, nonEmptyState());
  assert.deepEqual(result, { ok: false, reason: "version_conflict" });
});

test("12. a conflicting save never overwrites the newer state", async () => {
  reset();
  const seeded = seedRow({ state: nonEmptyState(), version: 5 });
  const before = JSON.parse(JSON.stringify(seeded.state));
  const result = await saveNoaSession(seeded.id, 4, createEmptyNoaConversationState());
  assert.deepEqual(result, { ok: false, reason: "version_conflict" });
  assert.deepEqual(rows[0].state, before);
  assert.equal(rows[0].version, 5);
});

// ── EXPIRY ───────────────────────────────────────────────────────────────────

test("13. an expired session is never treated as active - load falls through to a fresh one", async () => {
  reset();
  const seeded = seedRow({ expires_at: new Date(Date.now() - 60_000).toISOString(), state: nonEmptyState() });
  const result = await loadOrCreateNoaSession(seeded.id);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.notEqual(result.session.sessionId, seeded.id);
  assert.deepEqual(result.session.state, createEmptyNoaConversationState());
});

test("14. a successful load refreshes expiry", async () => {
  reset();
  const seeded = seedRow({ expires_at: new Date(Date.now() + 60_000).toISOString() });
  await loadOrCreateNoaSession(seeded.id);
  const refreshedMinutes = (new Date(rows[0].expires_at).getTime() - Date.now()) / 60_000;
  assert.ok(refreshedMinutes > 25);
});

test("15. a successful save refreshes expiry", async () => {
  reset();
  const seeded = seedRow({ expires_at: new Date(Date.now() + 60_000).toISOString() });
  await saveNoaSession(seeded.id, seeded.version, nonEmptyState());
  const refreshedMinutes = (new Date(rows[0].expires_at).getTime() - Date.now()) / 60_000;
  assert.ok(refreshedMinutes > 25);
});

test("16. expiry duration is not client-controlled", async () => {
  reset();
  const result = await loadOrCreateNoaSession();
  assert.ok(result.ok);
  // No parameter exists on any exported function to set expires_at - verified structurally:
  assert.equal(loadOrCreateNoaSession.length, 1);
  assert.equal(saveNoaSession.length, 3);
  assert.equal(refreshNoaSessionExpiry.length, 1);
});

// ── VALIDATION ───────────────────────────────────────────────────────────────

test("17. invalid state is never persisted", async () => {
  reset();
  const seeded = seedRow();
  const invalid = { schemaVersion: 1, resultSets: [], focus: null, extraField: "not allowed" } as unknown as NoaConversationState;
  const result = await saveNoaSession(seeded.id, 0, invalid);
  assert.deepEqual(result, { ok: false, reason: "invalid_state" });
  assert.equal(rows[0].version, 0);
});

test("18. an oversized ResultSet stack is rejected", async () => {
  reset();
  const seeded = seedRow();
  const oversized: NoaConversationState = {
    focus: null,
    resultSets: Array.from({ length: 6 }, () => ({
      count: 1, createdAt: "2026-01-01T00:00:00.000Z", entityType: "quotation" as const,
      handle: createNoaResultSetHandle(), items: [{ id: "11111111-1111-4111-8111-111111111111" }], kind: "entity" as const,
    })),
    schemaVersion: 1,
  };
  const result = await saveNoaSession(seeded.id, 0, oversized);
  assert.deepEqual(result, { ok: false, reason: "invalid_state" });
});

test("19. a dangling focus handle is rejected via the shared validator", async () => {
  reset();
  const seeded = seedRow();
  const dangling: NoaConversationState = { focus: { resultSetHandle: createNoaResultSetHandle() }, resultSets: [], schemaVersion: 1 };
  const result = await saveNoaSession(seeded.id, 0, dangling);
  assert.deepEqual(result, { ok: false, reason: "invalid_state" });
});

// ── ERROR SAFETY ─────────────────────────────────────────────────────────────

test("20. storage errors map to closed, safe errors", async () => {
  reset();
  insertShouldError = true;
  const created = await loadOrCreateNoaSession();
  assert.deepEqual(created, { ok: false, reason: "storage_error" });
  insertShouldError = false;
  const seeded = seedRow();
  updateShouldError = true;
  const saved = await saveNoaSession(seeded.id, seeded.version, nonEmptyState());
  assert.deepEqual(saved, { ok: false, reason: "storage_error" });
  const refreshed = await refreshNoaSessionExpiry(seeded.id);
  assert.deepEqual(refreshed, { ok: false, reason: "storage_error" });
});

test("21. no raw Supabase error/message ever reaches the caller", async () => {
  reset();
  insertShouldError = true;
  const result = await loadOrCreateNoaSession();
  assert.deepEqual(Object.keys(result).sort(), ["ok", "reason"]);
  assert.equal(JSON.stringify(result).includes("insert failed"), false);
});

test("unauthenticated caller gets a closed unauthorized result, never a thrown redirect", async () => {
  reset();
  currentUserId = null;
  assert.deepEqual(await loadOrCreateNoaSession(), { ok: false, reason: "unauthorized" });
  assert.deepEqual(await saveNoaSession("session-x", 0, createEmptyNoaConversationState()), { ok: false, reason: "unauthorized" });
  assert.deepEqual(await refreshNoaSessionExpiry("session-x"), { ok: false, reason: "unauthorized" });
});

test("refreshNoaSessionExpiry extends an owned, unexpired session and reports not_found otherwise", async () => {
  reset();
  const seeded = seedRow({ expires_at: new Date(Date.now() + 60_000).toISOString() });
  assert.deepEqual(await refreshNoaSessionExpiry(seeded.id), { ok: true });
  const refreshedMinutes = (new Date(rows[0].expires_at).getTime() - Date.now()) / 60_000;
  assert.ok(refreshedMinutes > 25);
  assert.deepEqual(await refreshNoaSessionExpiry("nonexistent"), { ok: false, reason: "not_found" });
});
