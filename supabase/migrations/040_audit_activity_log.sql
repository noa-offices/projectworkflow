create table if not exists public.audit_activity_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  parent_entity_type text,
  parent_entity_id uuid,
  action text not null,
  title text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists audit_activity_log_entity_idx
on public.audit_activity_log (entity_type, entity_id);

create index if not exists audit_activity_log_parent_entity_idx
on public.audit_activity_log (parent_entity_type, parent_entity_id);

create index if not exists audit_activity_log_created_at_idx
on public.audit_activity_log (created_at desc);

create index if not exists audit_activity_log_created_by_idx
on public.audit_activity_log (created_by);

alter table public.audit_activity_log enable row level security;

drop policy if exists audit_activity_log_select_active_users on public.audit_activity_log;

create policy audit_activity_log_select_active_users
on public.audit_activity_log
for select
to authenticated
using (public.current_user_is_active());

drop policy if exists audit_activity_log_insert_managers on public.audit_activity_log;

create policy audit_activity_log_insert_managers
on public.audit_activity_log
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists audit_activity_log_update_managers on public.audit_activity_log;

create policy audit_activity_log_update_managers
on public.audit_activity_log
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

grant select, insert, update on public.audit_activity_log to authenticated;
