-- Phase 1A: shadow-state foundation only. No chat path reads or writes this table yet.
-- version is an optimistic-concurrency counter; state.schemaVersion is independent.
create table if not exists public.noa_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  version integer not null default 0 check (version >= 0),
  state jsonb not null default '{"schemaVersion":1,"resultSets":[],"focus":null}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  constraint noa_sessions_state_object_check check (jsonb_typeof(state) = 'object'),
  constraint noa_sessions_state_size_check check (octet_length(state::text) <= 65536),
  constraint noa_sessions_expiry_check check (expires_at > created_at)
);

create index if not exists noa_sessions_user_expiry_idx
on public.noa_sessions (user_id, expires_at);

drop trigger if exists noa_sessions_set_updated_at on public.noa_sessions;
create trigger noa_sessions_set_updated_at
before update on public.noa_sessions
for each row execute function public.set_updated_at();

alter table public.noa_sessions enable row level security;

-- No role-based cross-user exception: even an app system_owner sees only their own sessions.
drop policy if exists noa_sessions_select_own on public.noa_sessions;
create policy noa_sessions_select_own
on public.noa_sessions for select to authenticated
using (user_id = (select auth.uid()) and (select public.current_user_is_active()));

drop policy if exists noa_sessions_insert_own on public.noa_sessions;
create policy noa_sessions_insert_own
on public.noa_sessions for insert to authenticated
with check (user_id = (select auth.uid()) and (select public.current_user_is_active()));

drop policy if exists noa_sessions_update_own on public.noa_sessions;
create policy noa_sessions_update_own
on public.noa_sessions for update to authenticated
using (user_id = (select auth.uid()) and (select public.current_user_is_active()))
with check (user_id = (select auth.uid()) and (select public.current_user_is_active()));

drop policy if exists noa_sessions_delete_own on public.noa_sessions;
create policy noa_sessions_delete_own
on public.noa_sessions for delete to authenticated
using (user_id = (select auth.uid()) and (select public.current_user_is_active()));

revoke all on public.noa_sessions from public, anon, authenticated;
grant select, insert, delete on public.noa_sessions to authenticated;
-- Ownership, identity and creation time are immutable for ordinary authenticated callers.
grant update (version, state, expires_at) on public.noa_sessions to authenticated;
-- Existing server-only admin client convention; no new privileged runtime path is introduced.
grant select, insert, update, delete on public.noa_sessions to service_role;

-- Phase 1B must validate state before use, re-authorize referenced entities, enforce expiry,
-- and compare/increment version atomically. No expiry refresh, cleanup job or RPC in Phase 1A.
