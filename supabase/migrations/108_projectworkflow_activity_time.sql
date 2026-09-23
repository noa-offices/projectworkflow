create table if not exists public.projectworkflow_activity_settings (
  id smallint primary key default 1 check (id = 1),
  organization_timezone text not null default 'UTC' check (length(trim(organization_timezone)) > 0),
  activity_idle_timeout_minutes integer not null default 15
    check (activity_idle_timeout_minutes between 5 and 60),
  updated_at timestamptz not null default now()
);

insert into public.projectworkflow_activity_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.projectworkflow_activity_intervals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  activity_date date not null,
  started_at timestamptz not null,
  last_activity_at timestamptz not null,
  ended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projectworkflow_activity_intervals_time_order_check check (
    last_activity_at >= started_at
    and (ended_at is null or ended_at >= last_activity_at)
  )
);

create table if not exists public.projectworkflow_activity_daily (
  profile_id uuid not null references public.profiles(id) on delete restrict,
  activity_date date not null,
  first_activity_at timestamptz not null,
  latest_activity_at timestamptz not null,
  active_minutes integer not null default 0 check (active_minutes >= 0),
  interval_count integer not null default 0 check (interval_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, activity_date),
  constraint projectworkflow_activity_daily_time_order_check check (latest_activity_at >= first_activity_at)
);

create unique index if not exists projectworkflow_activity_one_open_interval_per_profile_idx
on public.projectworkflow_activity_intervals (profile_id)
where ended_at is null;

create index if not exists projectworkflow_activity_intervals_profile_date_idx
on public.projectworkflow_activity_intervals (profile_id, activity_date);

create index if not exists projectworkflow_activity_intervals_recent_idx
on public.projectworkflow_activity_intervals (last_activity_at desc);

create index if not exists projectworkflow_activity_daily_date_idx
on public.projectworkflow_activity_daily (activity_date desc);

drop trigger if exists projectworkflow_activity_settings_set_updated_at on public.projectworkflow_activity_settings;
create trigger projectworkflow_activity_settings_set_updated_at
before update on public.projectworkflow_activity_settings
for each row execute function public.set_updated_at();

drop trigger if exists projectworkflow_activity_intervals_set_updated_at on public.projectworkflow_activity_intervals;
create trigger projectworkflow_activity_intervals_set_updated_at
before update on public.projectworkflow_activity_intervals
for each row execute function public.set_updated_at();

drop trigger if exists projectworkflow_activity_daily_set_updated_at on public.projectworkflow_activity_daily;
create trigger projectworkflow_activity_daily_set_updated_at
before update on public.projectworkflow_activity_daily
for each row execute function public.set_updated_at();

alter table public.projectworkflow_activity_settings enable row level security;
alter table public.projectworkflow_activity_intervals enable row level security;
alter table public.projectworkflow_activity_daily enable row level security;

drop policy if exists projectworkflow_activity_settings_select_active_users on public.projectworkflow_activity_settings;
create policy projectworkflow_activity_settings_select_active_users
on public.projectworkflow_activity_settings for select to authenticated
using (public.current_user_is_active());

drop policy if exists projectworkflow_activity_settings_update_system_owner on public.projectworkflow_activity_settings;
create policy projectworkflow_activity_settings_update_system_owner
on public.projectworkflow_activity_settings for update to authenticated
using (public.current_user_is_active() and public.current_user_role() = 'system_owner')
with check (public.current_user_is_active() and public.current_user_role() = 'system_owner');

drop policy if exists projectworkflow_activity_intervals_select_own_active_user on public.projectworkflow_activity_intervals;
create policy projectworkflow_activity_intervals_select_own_active_user
on public.projectworkflow_activity_intervals for select to authenticated
using (profile_id = auth.uid() and public.current_user_is_active());

drop policy if exists projectworkflow_activity_intervals_select_system_owner on public.projectworkflow_activity_intervals;
create policy projectworkflow_activity_intervals_select_system_owner
on public.projectworkflow_activity_intervals for select to authenticated
using (public.current_user_is_active() and public.current_user_role() = 'system_owner');

drop policy if exists projectworkflow_activity_daily_select_own_active_user on public.projectworkflow_activity_daily;
create policy projectworkflow_activity_daily_select_own_active_user
on public.projectworkflow_activity_daily for select to authenticated
using (profile_id = auth.uid() and public.current_user_is_active());

drop policy if exists projectworkflow_activity_daily_select_system_owner on public.projectworkflow_activity_daily;
create policy projectworkflow_activity_daily_select_system_owner
on public.projectworkflow_activity_daily for select to authenticated
using (public.current_user_is_active() and public.current_user_role() = 'system_owner');

revoke all on public.projectworkflow_activity_settings from anon, authenticated;
revoke all on public.projectworkflow_activity_intervals from anon, authenticated;
revoke all on public.projectworkflow_activity_daily from anon, authenticated;
grant select, update on public.projectworkflow_activity_settings to authenticated;
grant select on public.projectworkflow_activity_intervals to authenticated;
grant select on public.projectworkflow_activity_daily to authenticated;
