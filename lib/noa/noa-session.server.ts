import "server-only";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createEmptyNoaConversationState, parseNoaConversationState, type NoaConversationState } from "./noa-conversation-state";
import { NOA_SESSION_IDLE_EXPIRY_MINUTES } from "./noa-result-set";

// Phase 1B: server-side repository for the noa_sessions row Phase 1A's migration created. This
// module is not wired into runNoaOrchestrator/the chat route/the client yet (Phase 1C) - nothing
// here changes current NOA behavior.
//
// Session identity: the migration's own `id` (uuid primary key) IS the session identifier; there
// is no separate "conversation id" column and no unique constraint tying a user to a single row,
// so this repository never assumes "one active session per user" - callers name the session they
// want by its id, exactly the shape a future chat layer can round-trip like conversationReference.
//
// Malformed-state policy (Part 3): a row whose `state` JSONB fails Phase 1A's own
// isNoaConversationState() validation is reported as `invalid_state` and left untouched - never
// auto-repaired in place. Auto-repairing on a mere read would be an invisible write on a read
// path and could race a concurrent writer; returning a closed error lets the (future) caller
// decide, e.g. by starting a fresh session explicitly. A MISSING or EXPIRED session, by contrast,
// is safely and transparently replaced with a fresh empty one - unlike corrupted state, "no
// session yet" and "idle timeout" are the ordinary, expected end of a session's life, and this
// state is disposable conversational scope, never cached business truth (see noa-result-set.ts).
//
// Ownership (Part 6, defense in depth): every query is scoped by BOTH the caller's own user_id
// (explicit .eq() below) AND the migration's RLS policies (auth.uid() ownership + active-account
// check) - the authenticated server client is used throughout, never a service-role bypass. A
// session id that exists but belongs to someone else is therefore indistinguishable from one that
// does not exist at all: on load it falls through to "create fresh" like any other miss, and on
// save/refresh it falls through to the same conflict/not-found result a stale id would produce.
// This repository intentionally never reveals which case occurred.
//
// Versioning (Part 5): save() is a single compare-and-swap UPDATE gated on id + user_id + the
// caller's expectedVersion + not-yet-expired. Zero rows affected can mean a stale version, a
// wrong/foreign id, or expiry - this repository cannot safely tell those apart without an extra
// read (which would itself leak existence/ownership information), so all three collapse into one
// `version_conflict` result. No retry is attempted here.

export type NoaSessionErrorReason = "not_found" | "version_conflict" | "invalid_state" | "unauthorized" | "storage_error";

export type NoaSession = { sessionId: string; state: NoaConversationState; version: number };

export type NoaSessionLoadResult = { ok: true; session: NoaSession } | { ok: false; reason: NoaSessionErrorReason };
export type NoaSessionSaveResult = { ok: true; version: number } | { ok: false; reason: NoaSessionErrorReason };
export type NoaSessionRefreshResult = { ok: true } | { ok: false; reason: NoaSessionErrorReason };

type NoaSessionRow = { id: string; state: unknown; version: number };

function isNextRedirectError(error: unknown): boolean {
  return error instanceof Error && "digest" in error &&
    typeof (error as Error & { digest?: unknown }).digest === "string" &&
    (error as Error & { digest: string }).digest.startsWith("NEXT_REDIRECT");
}

// The one centralized expiry duration (Part 4) - reused, not redefined, from Phase 1A.
function noaSessionExpiryTimestamp(): string {
  return new Date(Date.now() + NOA_SESSION_IDLE_EXPIRY_MINUTES * 60_000).toISOString();
}

async function requireNoaSessionUserId(): Promise<{ ok: true; userId: string } | { ok: false; reason: "unauthorized" }> {
  try {
    const authed = await requireActiveUser();
    return { ok: true, userId: authed.user.id };
  } catch (error) {
    if (isNextRedirectError(error)) return { ok: false, reason: "unauthorized" };
    throw error;
  }
}

async function createNoaSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<NoaSessionLoadResult> {
  const { data, error } = await supabase
    .from("noa_sessions")
    .insert({ expires_at: noaSessionExpiryTimestamp(), state: createEmptyNoaConversationState(), user_id: userId })
    .select("id,state,version")
    .single<NoaSessionRow>();
  if (error || !data) return { ok: false, reason: "storage_error" };
  // Freshly created from createEmptyNoaConversationState(); no re-validation needed.
  return { ok: true, session: { sessionId: data.id, state: data.state as NoaConversationState, version: data.version } };
}

// Load the caller's own session by id, refreshing its idle expiry on success; falls through to a
// freshly created session whenever no id is given, the id doesn't resolve to the caller's own
// still-valid row, or the row's state is missing (never when it is merely malformed - see the
// module-level note above). Never returns another user's data.
export async function loadOrCreateNoaSession(sessionId?: string): Promise<NoaSessionLoadResult> {
  const authResult = await requireNoaSessionUserId();
  if (!authResult.ok) return authResult;
  const { userId } = authResult;
  const supabase = await createClient();

  if (sessionId) {
    const { data, error } = await supabase
      .from("noa_sessions")
      .select("id,state,version")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle<NoaSessionRow>();
    if (error) return { ok: false, reason: "storage_error" };
    if (data) {
      const parsed = parseNoaConversationState(JSON.stringify(data.state));
      if (!parsed) return { ok: false, reason: "invalid_state" };
      // Best-effort expiry refresh: a transient failure here must not fail an otherwise-successful
      // load (worst case the idle timer isn't extended this turn, never a correctness/security
      // issue) - and it never touches `state`/`version`, so it cannot race a concurrent save.
      await supabase.from("noa_sessions").update({ expires_at: noaSessionExpiryTimestamp() })
        .eq("id", sessionId).eq("user_id", userId);
      return { ok: true, session: { sessionId: data.id, state: parsed, version: data.version } };
    }
  }
  return createNoaSession(supabase, userId);
}

// Validates nextState (Part 7, reusing Phase 1A's parseNoaConversationState - never duplicated)
// before ever touching storage, then applies it as a single compare-and-swap UPDATE.
export async function saveNoaSession(
  sessionId: string,
  expectedVersion: number,
  nextState: NoaConversationState,
): Promise<NoaSessionSaveResult> {
  const authResult = await requireNoaSessionUserId();
  if (!authResult.ok) return authResult;
  const { userId } = authResult;

  const parsed = parseNoaConversationState(JSON.stringify(nextState));
  if (!parsed) return { ok: false, reason: "invalid_state" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("noa_sessions")
    .update({ expires_at: noaSessionExpiryTimestamp(), state: parsed, version: expectedVersion + 1 })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("version", expectedVersion)
    .gt("expires_at", new Date().toISOString())
    .select("version")
    .maybeSingle<{ version: number }>();
  if (error) return { ok: false, reason: "storage_error" };
  if (!data) return { ok: false, reason: "version_conflict" };
  return { ok: true, version: data.version };
}

// Standalone idle-timer extension (e.g. a future heartbeat), independent of load/save's own
// inline refresh. Ownership/expiry are collapsed into `not_found` for the same non-distinguishing
// reason save() collapses them into `version_conflict`.
export async function refreshNoaSessionExpiry(sessionId: string): Promise<NoaSessionRefreshResult> {
  const authResult = await requireNoaSessionUserId();
  if (!authResult.ok) return authResult;
  const { userId } = authResult;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("noa_sessions")
    .update({ expires_at: noaSessionExpiryTimestamp() })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) return { ok: false, reason: "storage_error" };
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true };
}
