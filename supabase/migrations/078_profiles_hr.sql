-- ─── profiles_hr ──────────────────────────────────────────────────────────────
-- Stores HR-only data per user. Separate from profiles so the existing
-- self-service update trigger on profiles does not need to be changed, and so
-- HR fields can have their own access-control tier (managers only for writes).

create table if not exists public.profiles_hr (
  id                     uuid        primary key default gen_random_uuid(),
  profile_id             uuid        not null unique references public.profiles(id) on delete cascade,
  date_of_joining        date,
  annual_leave_days      integer     not null default 30,
  leave_taken_this_year  integer     not null default 0,
  emirates_id_expiry     date,
  passport_expiry        date,
  emergency_contact_name  text,
  emergency_contact_phone text,
  hr_notes               text,
  updated_by             uuid        references public.profiles(id),
  updated_at             timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

create index if not exists profiles_hr_profile_id_idx
on public.profiles_hr (profile_id);

drop trigger if exists profiles_hr_set_updated_at on public.profiles_hr;

create trigger profiles_hr_set_updated_at
before update on public.profiles_hr
for each row
execute function public.set_updated_at();

alter table public.profiles_hr enable row level security;

drop policy if exists profiles_hr_select_own on public.profiles_hr;

create policy profiles_hr_select_own
on public.profiles_hr
for select
to authenticated
using (profile_id = auth.uid() and public.current_user_is_active());

drop policy if exists profiles_hr_select_managers on public.profiles_hr;

create policy profiles_hr_select_managers
on public.profiles_hr
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists profiles_hr_insert_managers on public.profiles_hr;

create policy profiles_hr_insert_managers
on public.profiles_hr
for insert
to authenticated
with check (public.current_user_can_manage_settings());

drop policy if exists profiles_hr_update_managers on public.profiles_hr;

create policy profiles_hr_update_managers
on public.profiles_hr
for update
to authenticated
using (public.current_user_can_manage_settings())
with check (public.current_user_can_manage_settings());

grant select, insert, update on public.profiles_hr to authenticated;
grant all on public.profiles_hr to service_role;

-- ─── hr_expiry_notifications ──────────────────────────────────────────────────
-- Deduplication tracker for automated expiry-reminder notifications.
-- One row per (profile, field, threshold_days, day) prevents sending the same
-- reminder twice in the same calendar day.

create table if not exists public.hr_expiry_notifications (
  id              uuid    primary key default gen_random_uuid(),
  profile_id      uuid    not null references public.profiles(id) on delete cascade,
  field_name      text    not null,
  threshold_days  integer not null,
  sent_at         date    not null default current_date,

  constraint hr_expiry_notifications_unique
    unique (profile_id, field_name, threshold_days, sent_at)
);

alter table public.hr_expiry_notifications enable row level security;

drop policy if exists hr_expiry_notifications_select_managers on public.hr_expiry_notifications;

create policy hr_expiry_notifications_select_managers
on public.hr_expiry_notifications
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists hr_expiry_notifications_insert_managers on public.hr_expiry_notifications;

create policy hr_expiry_notifications_insert_managers
on public.hr_expiry_notifications
for insert
to authenticated
with check (public.current_user_can_manage_settings());

drop policy if exists hr_expiry_notifications_update_managers on public.hr_expiry_notifications;

create policy hr_expiry_notifications_update_managers
on public.hr_expiry_notifications
for update
to authenticated
using (public.current_user_can_manage_settings())
with check (public.current_user_can_manage_settings());

grant select, insert, update on public.hr_expiry_notifications to authenticated;
grant all on public.hr_expiry_notifications to service_role;
