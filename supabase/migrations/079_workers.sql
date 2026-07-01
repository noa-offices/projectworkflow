-- ─── workers ──────────────────────────────────────────────────────────────────
-- Stores site/field worker records independently from the user-accounts system.
-- Workers are not Supabase auth users; they are managed by settings managers.

create table if not exists public.workers (
  id                   uuid         primary key default gen_random_uuid(),
  full_name            text         not null,
  phone                text,
  nationality          text,
  trade                text,
  daily_rate           numeric(10,2),
  emirates_id_number   text,
  emirates_id_expiry   date,
  passport_number      text,
  passport_expiry      date,
  status               text         not null default 'active'
    check (status in ('active', 'on_leave', 'offboarded')),
  notes                text,
  created_by           uuid         references public.profiles(id),
  updated_by           uuid         references public.profiles(id),
  updated_at           timestamptz  not null default now(),
  created_at           timestamptz  not null default now()
);

create index if not exists workers_status_idx
on public.workers (status);

create index if not exists workers_emirates_id_expiry_idx
on public.workers (emirates_id_expiry);

create index if not exists workers_passport_expiry_idx
on public.workers (passport_expiry);

drop trigger if exists workers_set_updated_at on public.workers;

create trigger workers_set_updated_at
before update on public.workers
for each row
execute function public.set_updated_at();

alter table public.workers enable row level security;

drop policy if exists workers_select_active_users on public.workers;

create policy workers_select_active_users
on public.workers
for select
to authenticated
using (public.current_user_is_active());

drop policy if exists workers_insert_managers on public.workers;

create policy workers_insert_managers
on public.workers
for insert
to authenticated
with check (public.current_user_can_manage_settings());

drop policy if exists workers_update_managers on public.workers;

create policy workers_update_managers
on public.workers
for update
to authenticated
using (public.current_user_can_manage_settings())
with check (public.current_user_can_manage_settings());

drop policy if exists workers_delete_managers on public.workers;

create policy workers_delete_managers
on public.workers
for delete
to authenticated
using (public.current_user_can_manage_settings());

grant select, insert, update, delete on public.workers to authenticated;
grant all on public.workers to service_role;

-- ─── worker_expiry_notifications ─────────────────────────────────────────────
-- Deduplication tracker for automated worker document-expiry reminders.
-- One row per (worker, field, threshold_days, day) prevents sending the same
-- reminder twice in the same calendar day.

create table if not exists public.worker_expiry_notifications (
  id              uuid     primary key default gen_random_uuid(),
  worker_id       uuid     not null references public.workers(id) on delete cascade,
  field_name      text     not null,
  threshold_days  integer  not null,
  sent_at         date     not null default current_date,

  constraint worker_expiry_notifications_unique
    unique (worker_id, field_name, threshold_days, sent_at)
);

alter table public.worker_expiry_notifications enable row level security;

drop policy if exists worker_expiry_notifications_select_managers on public.worker_expiry_notifications;

create policy worker_expiry_notifications_select_managers
on public.worker_expiry_notifications
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists worker_expiry_notifications_insert_managers on public.worker_expiry_notifications;

create policy worker_expiry_notifications_insert_managers
on public.worker_expiry_notifications
for insert
to authenticated
with check (public.current_user_can_manage_settings());

drop policy if exists worker_expiry_notifications_update_managers on public.worker_expiry_notifications;

create policy worker_expiry_notifications_update_managers
on public.worker_expiry_notifications
for update
to authenticated
using (public.current_user_can_manage_settings())
with check (public.current_user_can_manage_settings());

grant select, insert, update on public.worker_expiry_notifications to authenticated;
grant all on public.worker_expiry_notifications to service_role;
