// Follows the repo's static migration-contract pattern (activity-time ACT-1).
// Does not claim live RLS verification or apply anything to a Supabase project.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createEmptyNoaConversationState } from "./noa-conversation-state";
import { MAX_NOA_STATE_JSON_LENGTH, NOA_SESSION_IDLE_EXPIRY_MINUTES } from "./noa-result-set";

const sql = readFileSync("supabase/migrations/111_noa_sessions.sql", "utf8").replace(/--[^\n]*/g, "");
const statements = sql.split(";").map((statement) => statement.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);
const policy = (operation: string) => statements.filter((statement) => statement.startsWith("create policy ") && statement.includes(`for ${operation} `));
const ownership = "user_id = (select auth.uid()) and (select public.current_user_is_active())";

test("Phase 1A migration: only noa_sessions is created; ownership uses existing profile identity", () => {
  assert.deepEqual([...sql.matchAll(/create table if not exists ([\w.]+)/gi)].map((match) => match[1]), ["public.noa_sessions"]);
  assert.match(sql, /id uuid primary key default gen_random_uuid\(\)/i);
  assert.match(sql, /user_id uuid not null references public\.profiles\(id\) on delete cascade/i);
  for (const statement of statements.filter((statement) => statement.startsWith("alter table "))) {
    assert.equal(statement, "alter table public.noa_sessions enable row level security");
  }
  assert.doesNotMatch(sql, /create (?:or replace )?function|security definer|cron\./i);
});

test("Phase 1A migration: JSON object/size defaults align with the pure contract; versions stay separate", () => {
  const defaultState = sql.match(/state jsonb not null default '([^']+)'::jsonb/i)?.[1];
  assert.ok(defaultState);
  assert.deepEqual(JSON.parse(defaultState), createEmptyNoaConversationState());
  assert.match(sql, /version integer not null default 0 check \(version >= 0\)/i);
  assert.match(sql, /jsonb_typeof\(state\) = 'object'/i);
  assert.ok(statements.some((statement) => statement.includes(`octet_length(state::text) <= ${MAX_NOA_STATE_JSON_LENGTH}`)));
  assert.doesNotMatch(sql, /client_name|project_name|price|grand_total|assistant_text|prompt/i);
});

test("Phase 1A migration: bounded idle default, timestamps and ownership index exist", () => {
  assert.ok(sql.includes(`interval '${NOA_SESSION_IDLE_EXPIRY_MINUTES} minutes'`));
  for (const field of ["created_at", "updated_at"]) assert.ok(sql.includes(`${field} timestamptz not null default now()`));
  assert.match(sql, /expires_at timestamptz not null default/i);
  assert.match(sql, /check \(expires_at > created_at\)/i);
  assert.match(sql, /on public\.noa_sessions \(user_id, expires_at\)/i);
  assert.match(sql, /for each row execute function public\.set_updated_at\(\)/i);
});

test("Phase 1A migration: RLS policies require own active identity for every operation", () => {
  assert.ok(statements.includes("alter table public.noa_sessions enable row level security"));
  assert.equal(statements.filter((statement) => statement.startsWith("create policy ")).length, 4);
  for (const operation of ["select", "insert", "update", "delete"]) {
    const policies = policy(operation);
    assert.equal(policies.length, 1);
    const statement = policies[0];
    assert.ok(statement.includes(`on public.noa_sessions for ${operation} to authenticated`));
    if (operation !== "insert") assert.ok(statement.includes(`using (${ownership})`));
    if (operation === "insert" || operation === "update") assert.ok(statement.includes(`with check (${ownership})`));
    assert.doesNotMatch(statement, /\bor\b|system_owner|admin_manager|to anon/i);
  }
});

test("Phase 1A migration: anon/public revoked; authenticated cannot reassign user_id", () => {
  assert.ok(statements.includes("revoke all on public.noa_sessions from public, anon, authenticated"));
  const grants = statements.filter((statement) => statement.startsWith("grant "));
  assert.deepEqual(grants, [
    "grant select, insert, delete on public.noa_sessions to authenticated",
    "grant update (version, state, expires_at) on public.noa_sessions to authenticated",
    "grant select, insert, update, delete on public.noa_sessions to service_role",
  ]);
  assert.ok(policy("update")[0].includes(`with check (${ownership})`));
});
