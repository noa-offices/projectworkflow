-- Forward-only recovery for the partially applied leave lifecycle migration 094.
-- Migration 094 stopped while replacing this view because duplicate_entries was
-- inserted before the existing affected_workers column. Do not rerun 094.

drop view if exists public.leave_worker_legacy_import_report;

create view public.leave_worker_legacy_import_report as
with entries as (
  select
    w.id worker_id,
    e.value,
    nullif(btrim(e.value->>'id'), '') legacy_id,
    public.leave_safe_date(e.value->>'start_date') start_date,
    public.leave_safe_date(e.value->>'end_date') end_date
  from public.workers w
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(w.vacation_dates) = 'array' then w.vacation_dates
      else '[]'::jsonb
    end
  ) e(value)

  union all

  select w.id, w.vacation_dates, null, null, null
  from public.workers w
  where w.vacation_dates is not null
    and jsonb_typeof(w.vacation_dates) <> 'array'
), classified as (
  select
    *,
    jsonb_typeof(value) = 'object'
      and legacy_id is not null
      and start_date is not null
      and end_date is not null
      and end_date >= start_date valid
  from entries
), ranked as (
  select
    *,
    case
      when valid then row_number() over (
        partition by worker_id, legacy_id
        order by start_date, end_date, value::text
      )
    end duplicate_rank
  from classified
)
select
  count(*)::bigint total_entries,
  count(*) filter (where valid)::bigint valid_entries,
  count(*) filter (
    where valid
      and duplicate_rank = 1
      and exists (
        select 1
        from public.leave_requests lr
        where lr.legacy_reference =
          'worker-vacation:' || ranked.worker_id::text || ':' || ranked.legacy_id
      )
  )::bigint imported_entries,
  count(*) filter (where not valid)::bigint invalid_entries,
  count(*) filter (where valid and duplicate_rank > 1)::bigint duplicate_entries,
  count(distinct worker_id)::bigint affected_workers
from ranked;

-- These statements followed the failed view replacement in migration 094 and
-- may not have executed. DROP/CREATE POLICY and GRANT/REVOKE are safe to replay.
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
