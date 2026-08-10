-- Forward-only leave lifecycle normalization for application users and workers.
-- Migration 088 is historically deployed and must not be rerun in production.

do $$
begin
  if to_regclass('public.leave_requests') is null then
    raise exception 'Expected deployed table public.leave_requests is missing.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles_hr' and column_name = 'vacation_dates'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workers' and column_name = 'vacation_dates'
  ) then
    raise exception 'Expected deployed legacy vacation_dates columns are missing.';
  end if;
end;
$$;

alter table public.leave_requests
  alter column profile_id drop not null,
  add column if not exists worker_id uuid references public.workers(id) on delete restrict,
  add column if not exists approved_start_date date,
  add column if not exists approved_end_date date,
  add column if not exists actual_start_date date,
  add column if not exists actual_end_date date,
  add column if not exists return_to_work_date date,
  add column if not exists actual_days numeric(8,2),
  add column if not exists administrative_note text,
  add column if not exists early_return_reason text,
  add column if not exists early_returned_by uuid references public.profiles(id),
  add column if not exists early_returned_at timestamptz,
  add column if not exists legacy_source text,
  add column if not exists legacy_reference text;

alter table public.leave_requests drop constraint if exists leave_requests_status_check;
alter table public.leave_requests add constraint leave_requests_status_check
  check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'returned', 'cancelled', 'returned_early'));

alter table public.leave_requests drop constraint if exists leave_requests_subject_xor;
alter table public.leave_requests add constraint leave_requests_subject_xor
  check (num_nonnulls(profile_id, worker_id) = 1);

alter table public.leave_requests drop constraint if exists leave_requests_approved_dates_order;
alter table public.leave_requests add constraint leave_requests_approved_dates_order
  check (approved_end_date is null or approved_start_date is null or approved_end_date >= approved_start_date);

alter table public.leave_requests drop constraint if exists leave_requests_approved_dates_pair;
alter table public.leave_requests add constraint leave_requests_approved_dates_pair
  check ((approved_start_date is null) = (approved_end_date is null));

alter table public.leave_requests drop constraint if exists leave_requests_actual_dates_order;
alter table public.leave_requests add constraint leave_requests_actual_dates_order
  check (actual_end_date is null or actual_start_date is null or actual_end_date >= actual_start_date);

alter table public.leave_requests drop constraint if exists leave_requests_actual_dates_pair;
alter table public.leave_requests add constraint leave_requests_actual_dates_pair
  check ((actual_start_date is null) = (actual_end_date is null));

alter table public.leave_requests drop constraint if exists leave_requests_actual_days_positive;
alter table public.leave_requests add constraint leave_requests_actual_days_positive
  check (actual_days is null or actual_days > 0);

alter table public.leave_requests drop constraint if exists leave_requests_actual_days_dates;
alter table public.leave_requests add constraint leave_requests_actual_days_dates
  check (actual_days is null or (actual_start_date is not null and actual_end_date is not null));

alter table public.leave_requests drop constraint if exists leave_requests_return_after_actual_end;
alter table public.leave_requests add constraint leave_requests_return_after_actual_end
  check (return_to_work_date is null or (actual_end_date is not null and return_to_work_date > actual_end_date));

create unique index if not exists leave_requests_legacy_reference_uidx
  on public.leave_requests (legacy_reference) where legacy_reference is not null;
create index if not exists leave_requests_worker_dates_idx
  on public.leave_requests (worker_id, start_date, end_date) where worker_id is not null;
create index if not exists leave_requests_worker_created_idx
  on public.leave_requests (worker_id, created_at desc) where worker_id is not null;
create index if not exists leave_requests_status_dates_idx
  on public.leave_requests (status, start_date, end_date);

update public.leave_requests
set approved_start_date = coalesce(approved_start_date, start_date),
    approved_end_date = coalesce(approved_end_date, end_date)
where status = 'approved'
  and (approved_start_date is null or approved_end_date is null);

create or replace function public.leave_safe_date(p_value text)
returns date
language plpgsql immutable
set search_path = public
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p_value::date;
exception when others then
  return null;
end;
$$;

with worker_entries as (
  select w.id worker_id, entry.value
  from public.workers w
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(w.vacation_dates) = 'array' then w.vacation_dates else '[]'::jsonb end
  ) entry(value)
)
insert into public.leave_requests (
  profile_id, worker_id, leave_type, start_date, end_date, duration_type,
  requested_days, reason, status, approved_start_date, approved_end_date,
  administrative_note, legacy_source, legacy_reference
)
select
  null,
  entry.worker_id,
  'annual_leave',
  public.leave_safe_date(entry.value->>'start_date'),
  public.leave_safe_date(entry.value->>'end_date'),
  'full_day',
  public.leave_request_days(
    public.leave_safe_date(entry.value->>'start_date'),
    public.leave_safe_date(entry.value->>'end_date'),
    'full_day'
  ),
  nullif(btrim(entry.value->>'note'), ''),
  'approved',
  public.leave_safe_date(entry.value->>'start_date'),
  public.leave_safe_date(entry.value->>'end_date'),
  'Imported from legacy worker vacation dates.',
  'workers.vacation_dates',
  'worker-vacation:' || entry.worker_id::text || ':' || (entry.value->>'id')
from worker_entries entry
where jsonb_typeof(entry.value) = 'object'
  and nullif(btrim(entry.value->>'id'), '') is not null
  and public.leave_safe_date(entry.value->>'start_date') is not null
  and public.leave_safe_date(entry.value->>'end_date') is not null
  and public.leave_safe_date(entry.value->>'end_date') >= public.leave_safe_date(entry.value->>'start_date')
on conflict (legacy_reference) where legacy_reference is not null do nothing;

create table if not exists public.leave_balance_baselines (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete restrict,
  worker_id uuid references public.workers(id) on delete restrict,
  leave_year integer not null check (leave_year between 1900 and 2200),
  taken_days numeric(8,2) not null default 0 check (taken_days >= 0),
  source text not null,
  created_at timestamptz not null default now(),
  constraint leave_balance_baselines_subject_xor check (num_nonnulls(profile_id, worker_id) = 1)
);
create unique index if not exists leave_balance_baselines_profile_year_uidx
  on public.leave_balance_baselines (profile_id, leave_year) where profile_id is not null;
create unique index if not exists leave_balance_baselines_worker_year_uidx
  on public.leave_balance_baselines (worker_id, leave_year) where worker_id is not null;
alter table public.leave_balance_baselines enable row level security;
revoke all on public.leave_balance_baselines from authenticated;

insert into public.leave_balance_baselines (profile_id, leave_year, taken_days, source)
select
  hr.profile_id,
  extract(year from current_date)::integer,
  greatest(
    hr.leave_taken_this_year::numeric - coalesce((
      select sum(lr.balance_deducted)
      from public.leave_requests lr
      where lr.profile_id = hr.profile_id
        and lr.leave_type = 'annual_leave'
        and lr.status = 'approved'
        and lr.balance_deducted > 0
        and (extract(year from lr.start_date) = extract(year from current_date)
          or extract(year from lr.approved_at) = extract(year from current_date))
    ), 0),
    0
  ),
  'profiles_hr.leave_taken_this_year legacy baseline'
from public.profiles_hr hr
on conflict (profile_id, leave_year) where profile_id is not null do nothing;

insert into public.leave_balance_baselines (worker_id, leave_year, taken_days, source)
select
  w.id,
  extract(year from current_date)::integer,
  greatest(
    w.leave_taken_this_year::numeric - coalesce((
      select sum(lr.requested_days)
      from public.leave_requests lr
      where lr.worker_id = w.id
        and lr.legacy_source = 'workers.vacation_dates'
        and lr.leave_type = 'annual_leave'
        and lr.approved_end_date < current_date
        and extract(year from lr.approved_end_date) = extract(year from current_date)
    ), 0),
    0
  ),
  'workers.leave_taken_this_year legacy baseline'
from public.workers w
on conflict (worker_id, leave_year) where worker_id is not null do nothing;

create or replace function public.leave_actor_can_manage()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and account_status::text = 'active'
      and role::text in ('system_owner', 'admin_manager')
  );
$$;

create or replace function public.leave_request_days_in_year(
  p_start_date date,
  p_end_date date,
  p_duration_type text,
  p_year integer
) returns numeric
language plpgsql immutable
set search_path = public
as $$
declare
  v_start date := greatest(p_start_date, make_date(p_year, 1, 1));
  v_end date := least(p_end_date, make_date(p_year, 12, 31));
begin
  if p_start_date is null or p_end_date is null or v_end < v_start then return 0; end if;
  if p_duration_type in ('first_half', 'second_half') then
    return case when extract(year from p_start_date) = p_year then 0.5 else 0 end;
  end if;
  return (v_end - v_start + 1)::numeric;
end;
$$;

create or replace function public.leave_request_has_subject_overlap(
  p_profile_id uuid,
  p_worker_id uuid,
  p_start_date date,
  p_end_date date,
  p_exclude_request_id uuid default null
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.leave_requests lr
    where ((p_profile_id is not null and lr.profile_id = p_profile_id)
        or (p_worker_id is not null and lr.worker_id = p_worker_id))
      and lr.status in ('pending_approval', 'approved')
      and (p_exclude_request_id is null or lr.id <> p_exclude_request_id)
      and p_start_date <= lr.end_date
      and p_end_date >= lr.start_date
  );
$$;

create or replace function public.leave_request_has_overlap(
  p_profile_id uuid,
  p_start_date date,
  p_end_date date,
  p_exclude_request_id uuid default null
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.leave_request_has_subject_overlap(
    p_profile_id, null, p_start_date, p_end_date, p_exclude_request_id
  );
$$;

create or replace function public.get_leave_balance(
  p_profile_id uuid,
  p_worker_id uuid,
  p_year integer
) returns table (
  entitlement numeric,
  requested numeric,
  planned numeric,
  active numeric,
  taken numeric,
  remaining_entitlement numeric,
  available_to_plan numeric,
  approval_risk boolean
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_entitlement numeric;
  v_baseline numeric := 0;
begin
  if num_nonnulls(p_profile_id, p_worker_id) <> 1 then
    raise exception 'Exactly one leave subject is required.';
  end if;
  if not public.leave_actor_can_manage() and not (p_profile_id = auth.uid() and public.leave_actor_is_active()) then
    raise exception 'Permission denied.';
  end if;

  if p_profile_id is not null then
    select annual_leave_days::numeric into v_entitlement from public.profiles_hr where profile_id = p_profile_id;
    select coalesce(taken_days, 0) into v_baseline from public.leave_balance_baselines
      where profile_id = p_profile_id and leave_year = p_year;
  else
    select annual_leave_days::numeric into v_entitlement from public.workers where id = p_worker_id;
    select coalesce(taken_days, 0) into v_baseline from public.leave_balance_baselines
      where worker_id = p_worker_id and leave_year = p_year;
  end if;
  v_entitlement := coalesce(v_entitlement, 0);
  v_baseline := coalesce(v_baseline, 0);

  return query
  with annual as (
    select
      lr.*,
      lr.start_date effective_start,
      coalesce(lr.actual_end_date, lr.end_date) effective_end,
      coalesce(lr.actual_start_date, lr.start_date) taken_start
    from public.leave_requests lr
    where lr.leave_type = 'annual_leave'
      and ((p_profile_id is not null and lr.profile_id = p_profile_id)
        or (p_worker_id is not null and lr.worker_id = p_worker_id))
  ), sums as (
    select
      coalesce(sum(case when status = 'pending_approval'
        then public.leave_request_days_in_year(start_date, end_date, duration_type, p_year) else 0 end), 0) requested,
      coalesce(sum(case when status = 'approved' and effective_start > current_date
        then public.leave_request_days_in_year(effective_start, end_date, duration_type, p_year) else 0 end), 0) planned,
      coalesce(sum(case when status = 'approved' and current_date between effective_start and end_date
        then public.leave_request_days_in_year(effective_start, end_date, duration_type, p_year) else 0 end), 0) active,
      coalesce(sum(case
        when status in ('returned_early', 'cancelled') and actual_end_date is not null
          then case when actual_days is not null and extract(year from taken_start) = p_year and extract(year from actual_end_date) = p_year
            then actual_days else public.leave_request_days_in_year(taken_start, actual_end_date, duration_type, p_year) end
        when status = 'approved' and effective_end < current_date
          then case when actual_days is not null and extract(year from taken_start) = p_year and extract(year from effective_end) = p_year
            then actual_days else public.leave_request_days_in_year(taken_start, effective_end, duration_type, p_year) end
        else 0 end), 0) structured_taken
    from annual
  )
  select
    v_entitlement,
    round(s.requested, 2),
    round(s.planned, 2),
    round(s.active, 2),
    round(v_baseline + s.structured_taken, 2),
    round(v_entitlement - v_baseline - s.structured_taken, 2),
    round(v_entitlement - v_baseline - s.structured_taken - s.planned - s.active, 2),
    (v_baseline + s.structured_taken + s.planned + s.active + s.requested > v_entitlement)
  from sums s;
end;
$$;

create or replace function public.leave_assert_reservation_available(
  p_profile_id uuid,
  p_worker_id uuid,
  p_start_date date,
  p_end_date date,
  p_duration_type text,
  p_exclude_request_id uuid default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_year integer;
  v_new_days numeric;
  v_old_days numeric;
  v_balance record;
begin
  for v_year in extract(year from p_start_date)::integer..extract(year from p_end_date)::integer loop
    select * into v_balance from public.get_leave_balance(p_profile_id, p_worker_id, v_year);
    v_new_days := public.leave_request_days_in_year(p_start_date, p_end_date, p_duration_type, v_year);
    v_old_days := 0;
    if p_exclude_request_id is not null then
      select coalesce(public.leave_request_days_in_year(
        start_date, end_date, duration_type, v_year
      ), 0) into v_old_days
      from public.leave_requests where id = p_exclude_request_id and status = 'approved';
      v_old_days := coalesce(v_old_days, 0);
    end if;
    if v_new_days > v_balance.available_to_plan + v_old_days then
      raise exception 'Insufficient annual leave availability for %.', v_year;
    end if;
  end loop;
end;
$$;

create or replace function public.list_leave_balances(p_year integer)
returns table (
  profile_id uuid,
  worker_id uuid,
  entitlement numeric,
  requested numeric,
  planned numeric,
  active numeric,
  taken numeric,
  remaining_entitlement numeric,
  available_to_plan numeric,
  approval_risk boolean
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.leave_actor_can_manage() then raise exception 'Permission denied.'; end if;
  return query
  select hr.profile_id, null::uuid, b.*
  from public.profiles_hr hr
  cross join lateral public.get_leave_balance(hr.profile_id, null, p_year) b
  union all
  select null::uuid, w.id, b.*
  from public.workers w
  cross join lateral public.get_leave_balance(null, w.id, p_year) b;
end;
$$;

create or replace function public.approve_leave_request(p_request_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_request public.leave_requests%rowtype;
  v_days numeric;
begin
  if not public.leave_actor_can_manage() then raise exception 'Permission denied.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found then raise exception 'Vacation request not found.'; end if;
  if v_request.profile_id is null then raise exception 'Worker leave is created through the worker leave action.'; end if;
  if v_request.profile_id = auth.uid() then raise exception 'Self-approval is not permitted.'; end if;
  if v_request.status <> 'pending_approval' then raise exception 'Only pending requests can be approved.'; end if;
  if public.leave_request_has_subject_overlap(v_request.profile_id, null, v_request.start_date, v_request.end_date, v_request.id) then
    raise exception 'These dates overlap existing leave.';
  end if;
  v_days := public.leave_request_days(v_request.start_date, v_request.end_date, v_request.duration_type);
  if v_request.leave_type = 'annual_leave' then
    perform public.leave_assert_reservation_available(v_request.profile_id, null, v_request.start_date, v_request.end_date, v_request.duration_type, null);
  end if;
  update public.leave_requests set
    requested_days = v_days, status = 'approved', approved_by = auth.uid(), approved_at = now(),
    approved_start_date = start_date, approved_end_date = end_date,
    approved_vacation_entry_id = null, balance_deducted = 0
  where id = p_request_id;
  perform public.leave_audit(p_request_id, 'leave_request_approved', 'Vacation request approved',
    jsonb_build_object('subjectType', 'profile', 'profileId', v_request.profile_id,
      'previousStatus', v_request.status, 'newStatus', 'approved', 'approvedStartDate', v_request.start_date,
      'approvedEndDate', v_request.end_date, 'requestedDays', v_days, 'balanceEffect', 'reserved'));
  perform public.leave_notify(v_request.profile_id,
    'Vacation request approved' || E'\n' || v_request.start_date || ' to ' || v_request.end_date,
    '/settings/profile/vacation-requests?request=' || p_request_id);
end;
$$;

create or replace function public.submit_leave_request(p_request_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_request public.leave_requests%rowtype;
  v_days numeric;
  v_name text;
  v_body text;
begin
  if not public.leave_actor_is_active() then raise exception 'Permission denied.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or v_request.profile_id <> auth.uid() then raise exception 'Vacation request not found.'; end if;
  if v_request.status = 'pending_approval' then return; end if;
  if v_request.status not in ('draft', 'returned') then raise exception 'This request cannot be submitted.'; end if;
  if not exists (select 1 from public.profiles_hr where profile_id = v_request.profile_id) then
    raise exception 'Your HR leave record has not been set up.';
  end if;
  if public.leave_request_has_subject_overlap(v_request.profile_id, null, v_request.start_date, v_request.end_date, v_request.id) then
    raise exception 'These dates overlap an existing pending or approved vacation.';
  end if;
  v_days := public.leave_request_days(v_request.start_date, v_request.end_date, v_request.duration_type);
  update public.leave_requests set requested_days = v_days, status = 'pending_approval',
    submitted_by = auth.uid(), submitted_at = now() where id = p_request_id;
  select coalesce(full_name, email, 'Employee') into v_name from public.profiles where id = v_request.profile_id;
  v_body := 'Vacation request awaiting approval' || E'\n' || v_name || ' · ' ||
    replace(v_request.leave_type, '_', ' ') || ' · ' || v_request.start_date || ' to ' ||
    v_request.end_date || ' · ' || v_days || ' day(s)';
  perform public.leave_audit(p_request_id, 'leave_request_submitted', 'Vacation request submitted',
    jsonb_build_object('subjectType', 'profile', 'profileId', v_request.profile_id,
      'startDate', v_request.start_date, 'endDate', v_request.end_date,
      'requestedDays', v_days, 'balanceEffect', 'pending only'));
  perform public.leave_notify_system_owners(v_body, '/hr?leaveRequest=' || p_request_id, v_request.profile_id);
end;
$$;

create or replace function public.reject_leave_request(p_request_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_request public.leave_requests%rowtype;
begin
  if not public.leave_actor_can_manage() then raise exception 'Permission denied.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A rejection reason is required.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending_approval' then raise exception 'Only pending requests can be rejected.'; end if;
  update public.leave_requests set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(), decision_reason = btrim(p_reason) where id = p_request_id;
  perform public.leave_audit(p_request_id, 'leave_request_rejected', 'Vacation request rejected',
    jsonb_build_object('subjectType', case when v_request.worker_id is null then 'profile' else 'worker' end,
      'profileId', v_request.profile_id, 'workerId', v_request.worker_id, 'previousStatus', v_request.status,
      'newStatus', 'rejected', 'reason', btrim(p_reason)));
  if v_request.profile_id is not null then
    perform public.leave_notify(v_request.profile_id, 'Vacation request rejected' || E'\n' || btrim(p_reason),
      '/settings/profile/vacation-requests?request=' || p_request_id);
  end if;
end;
$$;

create or replace function public.return_leave_request(p_request_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_request public.leave_requests%rowtype;
begin
  if not public.leave_actor_can_manage() then raise exception 'Permission denied.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A return reason is required.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending_approval' then raise exception 'Only pending requests can be returned.'; end if;
  update public.leave_requests set status = 'returned', returned_by = auth.uid(), returned_at = now(), return_reason = btrim(p_reason) where id = p_request_id;
  perform public.leave_audit(p_request_id, 'leave_request_returned', 'Vacation request returned for changes',
    jsonb_build_object('subjectType', 'profile', 'profileId', v_request.profile_id,
      'previousStatus', v_request.status, 'newStatus', 'returned', 'reason', btrim(p_reason)));
  if v_request.profile_id is not null then
    perform public.leave_notify(v_request.profile_id, 'Vacation request needs changes' || E'\n' || btrim(p_reason),
      '/settings/profile/vacation-requests?request=' || p_request_id);
  end if;
end;
$$;

create or replace function public.create_worker_leave(
  p_worker_id uuid,
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_duration_type text default 'full_day',
  p_reason text default null,
  p_administrative_note text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid; v_days numeric;
begin
  if not public.leave_actor_can_manage() then raise exception 'Permission denied.'; end if;
  if not exists (select 1 from public.workers where id = p_worker_id) then raise exception 'Worker not found.'; end if;
  if p_leave_type not in ('annual_leave', 'sick_leave', 'unpaid_leave', 'emergency_leave', 'other') then raise exception 'Invalid leave type.'; end if;
  if public.leave_request_has_subject_overlap(null, p_worker_id, p_start_date, p_end_date, null) then raise exception 'These dates overlap existing leave.'; end if;
  v_days := public.leave_request_days(p_start_date, p_end_date, p_duration_type);
  if p_leave_type = 'annual_leave' then
    perform public.leave_assert_reservation_available(null, p_worker_id, p_start_date, p_end_date, p_duration_type, null);
  end if;
  insert into public.leave_requests (
    profile_id, worker_id, leave_type, start_date, end_date, duration_type, requested_days,
    reason, administrative_note, status, approved_by, approved_at, approved_start_date, approved_end_date
  ) values (
    null, p_worker_id, p_leave_type, p_start_date, p_end_date, p_duration_type, v_days,
    nullif(btrim(p_reason), ''), nullif(btrim(p_administrative_note), ''), 'approved', auth.uid(), now(), p_start_date, p_end_date
  ) returning id into v_id;
  perform public.leave_audit(v_id, 'worker_leave_created', 'Worker vacation created',
    jsonb_build_object('subjectType', 'worker', 'workerId', p_worker_id, 'newStatus', 'approved',
      'approvedStartDate', p_start_date, 'approvedEndDate', p_end_date, 'requestedDays', v_days));
  return v_id;
end;
$$;

create or replace function public.edit_managed_leave_request(
  p_request_id uuid,
  p_start_date date,
  p_end_date date,
  p_duration_type text,
  p_reason text,
  p_administrative_note text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_request public.leave_requests%rowtype; v_days numeric;
begin
  if not public.leave_actor_can_manage() then raise exception 'Permission denied.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'An edit reason is required.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or v_request.status not in ('pending_approval', 'approved') then raise exception 'This leave cannot be edited.'; end if;
  if v_request.status = 'approved' and v_request.start_date <= current_date then
    raise exception 'Active or completed leave requires actual-date correction.';
  end if;
  if public.leave_request_has_subject_overlap(v_request.profile_id, v_request.worker_id, p_start_date, p_end_date, p_request_id) then raise exception 'These dates overlap existing leave.'; end if;
  v_days := public.leave_request_days(p_start_date, p_end_date, p_duration_type);
  if v_request.status = 'approved' and v_request.leave_type = 'annual_leave' then
    perform public.leave_assert_reservation_available(v_request.profile_id, v_request.worker_id, p_start_date, p_end_date, p_duration_type, p_request_id);
  end if;
  update public.leave_requests set
    start_date = p_start_date, end_date = p_end_date, duration_type = p_duration_type,
    requested_days = v_days,
    administrative_note = coalesce(nullif(btrim(p_administrative_note), ''), administrative_note)
  where id = p_request_id;
  perform public.leave_audit(p_request_id, 'leave_dates_edited', 'Vacation dates edited',
    jsonb_build_object('subjectType', case when v_request.worker_id is null then 'profile' else 'worker' end,
      'profileId', v_request.profile_id, 'workerId', v_request.worker_id,
      'previousStartDate', v_request.start_date, 'previousEndDate', v_request.end_date,
      'newStartDate', p_start_date, 'newEndDate', p_end_date,
      'originalApprovedStartDate', v_request.approved_start_date,
      'originalApprovedEndDate', v_request.approved_end_date, 'reason', btrim(p_reason)));
end;
$$;

create or replace function public.cancel_approved_leave_request(p_request_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_request public.leave_requests%rowtype;
begin
  if not public.leave_actor_can_manage() then raise exception 'Permission denied.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A cancellation reason is required.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or v_request.status <> 'approved' then raise exception 'Only approved leave can be cancelled.'; end if;
  if v_request.start_date <= current_date then
    raise exception 'Active or completed leave requires actual-date handling.';
  end if;
  update public.leave_requests set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = btrim(p_reason) where id = p_request_id;
  perform public.leave_audit(p_request_id, 'leave_request_cancelled', 'Future approved vacation cancelled',
    jsonb_build_object('subjectType', case when v_request.worker_id is null then 'profile' else 'worker' end,
      'profileId', v_request.profile_id, 'workerId', v_request.worker_id,
      'previousStatus', v_request.status, 'newStatus', 'cancelled', 'balanceEffect', 'reservation released', 'reason', btrim(p_reason)));
  if v_request.profile_id is not null then
    perform public.leave_notify(v_request.profile_id, 'Approved vacation cancelled' || E'\n' || btrim(p_reason),
      '/settings/profile/vacation-requests?request=' || p_request_id);
  end if;
end;
$$;

create or replace function public.cancel_active_leave_request(
  p_request_id uuid,
  p_actual_end_date date,
  p_return_to_work_date date,
  p_reason text
) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_request public.leave_requests%rowtype; v_start date; v_approved_end date; v_days numeric;
begin
  if not public.leave_actor_can_manage() then raise exception 'Permission denied.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A cancellation reason is required.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or v_request.status <> 'approved' then raise exception 'Only active approved leave can use this action.'; end if;
  v_start := v_request.start_date;
  v_approved_end := v_request.end_date;
  if current_date < v_start or current_date > v_approved_end then raise exception 'Leave is not currently active.'; end if;
  if p_actual_end_date < v_start or p_actual_end_date > current_date or p_actual_end_date > v_approved_end then raise exception 'Invalid actual last leave date.'; end if;
  if p_return_to_work_date <= p_actual_end_date then raise exception 'Return-to-work date must follow the actual last leave date.'; end if;
  v_days := public.leave_request_days(v_start, p_actual_end_date, v_request.duration_type);
  update public.leave_requests set status = 'cancelled', actual_start_date = v_start, actual_end_date = p_actual_end_date,
    return_to_work_date = p_return_to_work_date, actual_days = v_days,
    cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = btrim(p_reason)
  where id = p_request_id;
  perform public.leave_audit(p_request_id, 'active_leave_cancelled', 'Active vacation cancelled',
    jsonb_build_object('subjectType', case when v_request.worker_id is null then 'profile' else 'worker' end,
      'profileId', v_request.profile_id, 'workerId', v_request.worker_id,
      'previousStatus', v_request.status, 'newStatus', 'cancelled',
      'approvedStartDate', v_start, 'approvedEndDate', v_approved_end,
      'actualEndDate', p_actual_end_date, 'returnToWorkDate', p_return_to_work_date,
      'actualDays', v_days, 'reason', btrim(p_reason)));
end;
$$;

create or replace function public.record_leave_early_return(
  p_request_id uuid,
  p_actual_end_date date,
  p_return_to_work_date date,
  p_reason text
) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_request public.leave_requests%rowtype; v_start date; v_end date; v_days numeric;
begin
  if not public.leave_actor_can_manage() then raise exception 'Permission denied.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'An early-return reason is required.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or v_request.status <> 'approved' then raise exception 'Only approved leave can record an early return.'; end if;
  v_start := v_request.start_date;
  v_end := v_request.end_date;
  if current_date < v_start then raise exception 'Leave has not begun.'; end if;
  if p_actual_end_date < v_start or p_actual_end_date >= v_end or p_actual_end_date > current_date then
    raise exception 'Actual last leave date must be between the approved start date and today, and before the approved end date.';
  end if;
  if p_return_to_work_date <= p_actual_end_date then raise exception 'Return-to-work date must follow the actual last leave date.'; end if;
  v_days := public.leave_request_days(v_start, p_actual_end_date, v_request.duration_type);
  update public.leave_requests set status = 'returned_early', actual_start_date = v_start,
    actual_end_date = p_actual_end_date, return_to_work_date = p_return_to_work_date,
    actual_days = v_days, early_return_reason = btrim(p_reason), early_returned_by = auth.uid(), early_returned_at = now()
  where id = p_request_id;
  perform public.leave_audit(p_request_id, 'leave_returned_early', 'Early return recorded',
    jsonb_build_object('subjectType', case when v_request.worker_id is null then 'profile' else 'worker' end,
      'profileId', v_request.profile_id, 'workerId', v_request.worker_id,
      'previousStatus', v_request.status, 'newStatus', 'returned_early',
      'approvedStartDate', v_start, 'approvedEndDate', v_end,
      'actualEndDate', p_actual_end_date, 'returnToWorkDate', p_return_to_work_date,
      'actualDays', v_days, 'unusedDays', v_request.requested_days - v_days, 'reason', btrim(p_reason)));
  if v_request.profile_id is not null then
    perform public.leave_notify(v_request.profile_id, 'Early return recorded' || E'\n' || btrim(p_reason),
      '/settings/profile/vacation-requests?request=' || p_request_id);
  end if;
end;
$$;

create or replace function public.correct_leave_actual_dates(
  p_request_id uuid,
  p_actual_start_date date,
  p_actual_end_date date,
  p_return_to_work_date date,
  p_reason text
) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_request public.leave_requests%rowtype; v_days numeric;
begin
  if not public.leave_actor_can_manage() then raise exception 'Permission denied.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A correction reason is required.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or v_request.status not in ('approved', 'returned_early', 'cancelled') then raise exception 'This leave cannot be corrected.'; end if;
  if p_actual_end_date < p_actual_start_date then raise exception 'Actual end cannot be before actual start.'; end if;
  if p_actual_end_date > current_date then raise exception 'Actual dates cannot end in the future.'; end if;
  if p_return_to_work_date is not null and p_return_to_work_date <= p_actual_end_date then raise exception 'Return-to-work date must follow actual end.'; end if;
  v_days := public.leave_request_days(p_actual_start_date, p_actual_end_date, v_request.duration_type);
  update public.leave_requests set actual_start_date = p_actual_start_date, actual_end_date = p_actual_end_date,
    return_to_work_date = p_return_to_work_date, actual_days = v_days,
    administrative_note = concat_ws(E'\n', nullif(administrative_note, ''), 'Actual dates corrected: ' || btrim(p_reason))
  where id = p_request_id;
  perform public.leave_audit(p_request_id, 'leave_actual_dates_corrected', 'Vacation actual dates corrected',
    jsonb_build_object('subjectType', case when v_request.worker_id is null then 'profile' else 'worker' end,
      'profileId', v_request.profile_id, 'workerId', v_request.worker_id,
      'previousActualStartDate', v_request.actual_start_date, 'previousActualEndDate', v_request.actual_end_date,
      'newActualStartDate', p_actual_start_date, 'newActualEndDate', p_actual_end_date,
      'returnToWorkDate', p_return_to_work_date, 'actualDays', v_days, 'reason', btrim(p_reason)));
end;
$$;

create or replace view public.leave_worker_legacy_import_report as
with entries as (
  select w.id worker_id, e.value,
    nullif(btrim(e.value->>'id'), '') legacy_id,
    public.leave_safe_date(e.value->>'start_date') start_date,
    public.leave_safe_date(e.value->>'end_date') end_date
  from public.workers w
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(w.vacation_dates) = 'array' then w.vacation_dates else '[]'::jsonb end
  ) e(value)
  union all
  select w.id, w.vacation_dates, null, null, null
  from public.workers w
  where w.vacation_dates is not null and jsonb_typeof(w.vacation_dates) <> 'array'
), classified as (
  select *, jsonb_typeof(value) = 'object' and legacy_id is not null
    and start_date is not null and end_date is not null and end_date >= start_date valid
  from entries
), ranked as (
  select *, case when valid then row_number() over (
    partition by worker_id, legacy_id order by start_date, end_date, value::text
  ) end duplicate_rank
  from classified
)
select
  count(*)::bigint total_entries,
  count(*) filter (where valid)::bigint valid_entries,
  count(*) filter (where valid and duplicate_rank = 1 and exists (
    select 1 from public.leave_requests lr
    where lr.legacy_reference = 'worker-vacation:' || ranked.worker_id::text || ':' || ranked.legacy_id
  ))::bigint imported_entries,
  count(*) filter (where not valid)::bigint invalid_entries,
  count(*) filter (where valid and duplicate_rank > 1)::bigint duplicate_entries,
  count(distinct worker_id)::bigint affected_workers
from ranked;

drop policy if exists leave_requests_select_own on public.leave_requests;
create policy leave_requests_select_own
on public.leave_requests for select to authenticated
using (profile_id = auth.uid() and public.leave_actor_is_active());

drop policy if exists leave_requests_select_hr_queue on public.leave_requests;
create policy leave_requests_select_hr_queue
on public.leave_requests for select to authenticated
using (public.leave_actor_can_manage());

revoke insert, update, delete on public.leave_requests from authenticated;
revoke all on public.leave_worker_legacy_import_report from public, authenticated;

revoke all on function public.leave_safe_date(text) from public;
revoke all on function public.leave_actor_can_manage() from public;
revoke all on function public.leave_request_days_in_year(date,date,text,integer) from public;
revoke all on function public.leave_request_has_subject_overlap(uuid,uuid,date,date,uuid) from public;
revoke all on function public.leave_request_has_overlap(uuid,date,date,uuid) from public, authenticated;
revoke all on function public.get_leave_balance(uuid,uuid,integer) from public;
revoke all on function public.leave_assert_reservation_available(uuid,uuid,date,date,text,uuid) from public;
revoke all on function public.list_leave_balances(integer) from public;
revoke all on function public.create_worker_leave(uuid,text,date,date,text,text,text) from public;
revoke all on function public.edit_managed_leave_request(uuid,date,date,text,text,text) from public;
revoke all on function public.cancel_active_leave_request(uuid,date,date,text) from public;
revoke all on function public.record_leave_early_return(uuid,date,date,text) from public;
revoke all on function public.correct_leave_actual_dates(uuid,date,date,date,text) from public;

grant execute on function public.get_leave_balance(uuid,uuid,integer) to authenticated;
grant execute on function public.leave_actor_can_manage() to authenticated;
grant execute on function public.leave_actor_is_active() to authenticated;
grant execute on function public.list_leave_balances(integer) to authenticated;
grant execute on function public.create_worker_leave(uuid,text,date,date,text,text,text) to authenticated;
grant execute on function public.edit_managed_leave_request(uuid,date,date,text,text,text) to authenticated;
grant execute on function public.cancel_active_leave_request(uuid,date,date,text) to authenticated;
grant execute on function public.record_leave_early_return(uuid,date,date,text) to authenticated;
grant execute on function public.correct_leave_actual_dates(uuid,date,date,date,text) to authenticated;

revoke all on function public.approve_leave_request(uuid) from public;
revoke all on function public.submit_leave_request(uuid) from public;
revoke all on function public.reject_leave_request(uuid,text) from public;
revoke all on function public.return_leave_request(uuid,text) from public;
revoke all on function public.cancel_approved_leave_request(uuid,text) from public;
grant execute on function public.approve_leave_request(uuid) to authenticated;
grant execute on function public.submit_leave_request(uuid) to authenticated;
grant execute on function public.reject_leave_request(uuid,text) to authenticated;
grant execute on function public.return_leave_request(uuid,text) to authenticated;
grant execute on function public.cancel_approved_leave_request(uuid,text) to authenticated;
