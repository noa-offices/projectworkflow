create or replace function public.refresh_projectworkflow_activity_daily(
  target_profile_id uuid,
  target_activity_date date,
  effective_now timestamptz,
  idle_timeout_minutes integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  summary_first timestamptz;
  summary_latest timestamptz;
  summary_minutes integer;
  summary_count integer;
begin
  with bounded as (
    select
      started_at,
      last_activity_at,
      coalesce(
        ended_at,
        least(effective_now, last_activity_at + make_interval(mins => idle_timeout_minutes))
      ) as effective_end
    from public.projectworkflow_activity_intervals
    where profile_id = target_profile_id
      and activity_date = target_activity_date
  ), ordered as (
    select
      *,
      max(effective_end) over (
        order by started_at, effective_end
        rows between unbounded preceding and 1 preceding
      ) as prior_max_end
    from bounded
    where effective_end >= started_at
  ), marked as (
    select
      *,
      case when prior_max_end is null or started_at > prior_max_end then 1 else 0 end as starts_group
    from ordered
  ), grouped as (
    select
      *,
      sum(starts_group) over (order by started_at, effective_end) as interval_group
    from marked
  ), merged as (
    select min(started_at) as merged_start, max(effective_end) as merged_end
    from grouped
    group by interval_group
  ), facts as (
    select
      (select min(started_at) from bounded) as first_activity,
      (select max(last_activity_at) from bounded) as latest_activity,
      (select count(*)::integer from bounded) as interval_total,
      coalesce((select floor(sum(extract(epoch from (merged_end - merged_start))) / 60)::integer from merged), 0) as minute_total
  )
  select first_activity, latest_activity, minute_total, interval_total
  into summary_first, summary_latest, summary_minutes, summary_count
  from facts;

  if summary_count = 0 then
    delete from public.projectworkflow_activity_daily
    where profile_id = target_profile_id and activity_date = target_activity_date;
    return;
  end if;

  insert into public.projectworkflow_activity_daily (
    profile_id,
    activity_date,
    first_activity_at,
    latest_activity_at,
    active_minutes,
    interval_count
  ) values (
    target_profile_id,
    target_activity_date,
    summary_first,
    summary_latest,
    summary_minutes,
    summary_count
  )
  on conflict (profile_id, activity_date) do update set
    first_activity_at = excluded.first_activity_at,
    latest_activity_at = excluded.latest_activity_at,
    active_minutes = excluded.active_minutes,
    interval_count = excluded.interval_count;
end;
$$;

create or replace function public.touch_projectworkflow_activity()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_profile_id uuid := auth.uid();
  current_timestamp_value timestamptz := clock_timestamp();
  current_activity_date date;
  previous_activity_date date;
  local_day_boundary timestamptz;
  timeout_interval interval;
  configuration public.projectworkflow_activity_settings%rowtype;
  open_interval public.projectworkflow_activity_intervals%rowtype;
  next_interval_start timestamptz;
begin
  if current_profile_id is null or not public.current_user_is_active() then
    raise exception 'active authentication required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_profile_id::text, 0));

  select * into configuration
  from public.projectworkflow_activity_settings
  where id = 1;

  if not found then
    raise exception 'activity settings unavailable';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = configuration.organization_timezone
  ) then
    raise exception 'invalid organization timezone';
  end if;

  timeout_interval := make_interval(mins => configuration.activity_idle_timeout_minutes);
  current_activity_date := (current_timestamp_value at time zone configuration.organization_timezone)::date;

  select * into open_interval
  from public.projectworkflow_activity_intervals
  where profile_id = current_profile_id and ended_at is null
  for update;

  if not found then
    insert into public.projectworkflow_activity_intervals (
      profile_id, activity_date, started_at, last_activity_at
    ) values (
      current_profile_id, current_activity_date, current_timestamp_value, current_timestamp_value
    );
  elsif open_interval.activity_date <> current_activity_date then
    previous_activity_date := open_interval.activity_date;
    local_day_boundary := current_activity_date::timestamp at time zone configuration.organization_timezone;
    next_interval_start := case
      when current_timestamp_value <= open_interval.last_activity_at + timeout_interval
        then local_day_boundary
      else current_timestamp_value
    end;

    update public.projectworkflow_activity_intervals
    set ended_at = least(open_interval.last_activity_at + timeout_interval, local_day_boundary)
    where id = open_interval.id;

    insert into public.projectworkflow_activity_intervals (
      profile_id, activity_date, started_at, last_activity_at
    ) values (
      current_profile_id, current_activity_date, next_interval_start, current_timestamp_value
    );
  elsif current_timestamp_value <= open_interval.last_activity_at + timeout_interval then
    update public.projectworkflow_activity_intervals
    set last_activity_at = current_timestamp_value
    where id = open_interval.id;
  else
    update public.projectworkflow_activity_intervals
    set ended_at = open_interval.last_activity_at + timeout_interval
    where id = open_interval.id;

    insert into public.projectworkflow_activity_intervals (
      profile_id, activity_date, started_at, last_activity_at
    ) values (
      current_profile_id, current_activity_date, current_timestamp_value, current_timestamp_value
    );
  end if;

  if previous_activity_date is not null then
    perform public.refresh_projectworkflow_activity_daily(
      current_profile_id,
      previous_activity_date,
      current_timestamp_value,
      configuration.activity_idle_timeout_minutes
    );
  end if;

  perform public.refresh_projectworkflow_activity_daily(
    current_profile_id,
    current_activity_date,
    current_timestamp_value,
    configuration.activity_idle_timeout_minutes
  );

  return jsonb_build_object('recorded', true);
end;
$$;

revoke all on function public.refresh_projectworkflow_activity_daily(uuid, date, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.touch_projectworkflow_activity() from public, anon;
grant execute on function public.touch_projectworkflow_activity() to authenticated;
