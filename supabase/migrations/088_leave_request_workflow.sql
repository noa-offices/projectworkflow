-- Authenticated staff vacation requests. Approved vacations continue to live in
-- profiles_hr.vacation_dates; this table stores workflow state only.

alter table public.profiles_hr
  alter column leave_taken_this_year type numeric(8,2)
  using leave_taken_this_year::numeric;

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  leave_type text not null check (leave_type in ('annual_leave', 'sick_leave', 'unpaid_leave', 'emergency_leave', 'other')),
  start_date date not null,
  end_date date not null,
  duration_type text not null default 'full_day' check (duration_type in ('full_day', 'first_half', 'second_half')),
  requested_days numeric(8,2) not null check (requested_days > 0),
  reason text,
  handover_note text,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'returned', 'cancelled')),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejected_by uuid references public.profiles(id),
  rejected_at timestamptz,
  decision_reason text,
  returned_by uuid references public.profiles(id),
  returned_at timestamptz,
  return_reason text,
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  last_reminder_at timestamptz,
  approved_vacation_entry_id uuid unique,
  balance_deducted numeric(8,2) not null default 0 check (balance_deducted >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_requests_date_order check (end_date >= start_date),
  constraint leave_requests_half_day_single_date check (
    duration_type = 'full_day' or start_date = end_date
  )
);

create index leave_requests_profile_created_idx
  on public.leave_requests (profile_id, created_at desc);
create index leave_requests_status_submitted_idx
  on public.leave_requests (status, submitted_at desc);
create index leave_requests_profile_dates_idx
  on public.leave_requests (profile_id, start_date, end_date);

create trigger leave_requests_set_updated_at
before update on public.leave_requests
for each row execute function public.set_updated_at();

alter table public.leave_requests enable row level security;

create policy leave_requests_select_own
on public.leave_requests for select to authenticated
using (profile_id = auth.uid() and public.current_user_is_active());

create policy leave_requests_select_hr_queue
on public.leave_requests for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.account_status::text = 'active'
      and p.role::text in ('system_owner', 'admin_manager')
  )
);

grant select on public.leave_requests to authenticated;
grant all on public.leave_requests to service_role;
revoke insert, update, delete on public.leave_requests from authenticated;

create or replace function public.leave_request_days(
  p_start_date date,
  p_end_date date,
  p_duration_type text
) returns numeric
language plpgsql immutable
set search_path = public
as $$
begin
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'End date cannot be before start date.';
  end if;
  if p_duration_type not in ('full_day', 'first_half', 'second_half') then
    raise exception 'Invalid duration type.';
  end if;
  if p_duration_type <> 'full_day' then
    if p_start_date <> p_end_date then
      raise exception 'Half-day leave must start and end on the same date.';
    end if;
    return 0.5;
  end if;
  return (p_end_date - p_start_date + 1)::numeric;
end;
$$;

create or replace function public.leave_actor_is_active()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and account_status::text = 'active'
  );
$$;

create or replace function public.leave_actor_is_system_owner()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and account_status::text = 'active'
      and role::text = 'system_owner'
  );
$$;

create or replace function public.leave_request_has_overlap(
  p_profile_id uuid,
  p_start_date date,
  p_end_date date,
  p_exclude_request_id uuid default null
) returns boolean
language sql stable security definer set search_path = public
as $$
  select
    exists (
      select 1 from public.leave_requests lr
      where lr.profile_id = p_profile_id
        and lr.status in ('pending_approval', 'approved')
        and (p_exclude_request_id is null or lr.id <> p_exclude_request_id)
        and p_start_date <= lr.end_date
        and p_end_date >= lr.start_date
    )
    or exists (
      select 1
      from public.profiles_hr hr
      cross join lateral jsonb_array_elements(coalesce(hr.vacation_dates, '[]'::jsonb)) entry
      where hr.profile_id = p_profile_id
        and jsonb_typeof(entry) = 'object'
        and entry ? 'start_date' and entry ? 'end_date'
        and entry->>'start_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and entry->>'end_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and p_start_date <= (entry->>'end_date')::date
        and p_end_date >= (entry->>'start_date')::date
    );
$$;

create or replace function public.leave_audit(
  p_request_id uuid,
  p_action text,
  p_title text,
  p_metadata jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_activity_log (
    entity_type, entity_id, action, title, metadata, created_by
  ) values (
    'leave_request', p_request_id, p_action, p_title, coalesce(p_metadata, '{}'::jsonb), auth.uid()
  );
$$;

create or replace function public.leave_notify(
  p_recipient_id uuid,
  p_body text,
  p_href text
) returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (recipient_id, sender_id, body, order_no)
  select p_recipient_id, auth.uid(), p_body, p_href
  where p_recipient_id is not null;
$$;

create or replace function public.leave_notify_system_owners(
  p_body text,
  p_href text,
  p_exclude_profile_id uuid default null
) returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (recipient_id, sender_id, body, order_no, sent_to_role)
  select distinct p.id, auth.uid(), p_body, p_href, 'system_owner'
  from public.profiles p
  where p.role::text = 'system_owner'
    and p.account_status::text = 'active'
    and (p_exclude_profile_id is null or p.id <> p_exclude_profile_id);
$$;

create or replace function public.create_leave_request(
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_duration_type text default 'full_day',
  p_reason text default null,
  p_handover_note text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_days numeric;
begin
  if not public.leave_actor_is_active() then raise exception 'Permission denied.'; end if;
  if p_leave_type not in ('annual_leave', 'sick_leave', 'unpaid_leave', 'emergency_leave', 'other') then
    raise exception 'Invalid leave type.';
  end if;
  v_days := public.leave_request_days(p_start_date, p_end_date, p_duration_type);
  insert into public.leave_requests (
    profile_id, leave_type, start_date, end_date, duration_type,
    requested_days, reason, handover_note
  ) values (
    auth.uid(), p_leave_type, p_start_date, p_end_date, p_duration_type,
    v_days, nullif(btrim(p_reason), ''), nullif(btrim(p_handover_note), '')
  ) returning id into v_id;
  perform public.leave_audit(v_id, 'leave_request_created', 'Vacation request draft created',
    jsonb_build_object('leaveType', p_leave_type, 'startDate', p_start_date, 'endDate', p_end_date, 'requestedDays', v_days));
  return v_id;
end;
$$;

create or replace function public.update_leave_request(
  p_request_id uuid,
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_duration_type text,
  p_reason text default null,
  p_handover_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_request public.leave_requests%rowtype;
  v_days numeric;
begin
  if not public.leave_actor_is_active() then raise exception 'Permission denied.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or v_request.profile_id <> auth.uid() then raise exception 'Vacation request not found.'; end if;
  if v_request.status not in ('draft', 'returned') then raise exception 'Only draft or returned requests can be edited.'; end if;
  if p_leave_type not in ('annual_leave', 'sick_leave', 'unpaid_leave', 'emergency_leave', 'other') then
    raise exception 'Invalid leave type.';
  end if;
  v_days := public.leave_request_days(p_start_date, p_end_date, p_duration_type);
  if v_request.leave_type = p_leave_type
    and v_request.start_date = p_start_date
    and v_request.end_date = p_end_date
    and v_request.duration_type = p_duration_type
    and v_request.requested_days = v_days
    and v_request.reason is not distinct from nullif(btrim(p_reason), '')
    and v_request.handover_note is not distinct from nullif(btrim(p_handover_note), '') then
    return;
  end if;
  update public.leave_requests set
    leave_type = p_leave_type, start_date = p_start_date, end_date = p_end_date,
    duration_type = p_duration_type, requested_days = v_days,
    reason = nullif(btrim(p_reason), ''), handover_note = nullif(btrim(p_handover_note), '')
  where id = p_request_id;
  perform public.leave_audit(p_request_id, 'leave_request_updated', 'Vacation request updated',
    jsonb_build_object('leaveType', p_leave_type, 'startDate', p_start_date, 'endDate', p_end_date, 'requestedDays', v_days));
end;
$$;

create or replace function public.submit_leave_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_request public.leave_requests%rowtype;
  v_hr public.profiles_hr%rowtype;
  v_days numeric;
  v_name text;
  v_balance numeric;
  v_body text;
begin
  if not public.leave_actor_is_active() then raise exception 'Permission denied.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or v_request.profile_id <> auth.uid() then raise exception 'Vacation request not found.'; end if;
  if v_request.status = 'pending_approval' then return; end if;
  if v_request.status not in ('draft', 'returned') then raise exception 'This request cannot be submitted.'; end if;
  v_days := public.leave_request_days(v_request.start_date, v_request.end_date, v_request.duration_type);
  select * into v_hr from public.profiles_hr where profile_id = v_request.profile_id for update;
  if not found then raise exception 'Your HR leave record has not been set up.'; end if;
  if public.leave_request_has_overlap(v_request.profile_id, v_request.start_date, v_request.end_date, v_request.id) then
    raise exception 'These dates overlap an existing pending or approved vacation.';
  end if;
  v_balance := v_hr.annual_leave_days - v_hr.leave_taken_this_year;
  if v_request.leave_type = 'annual_leave' and v_days > v_balance then
    raise exception 'Insufficient annual leave balance.';
  end if;
  update public.leave_requests set
    requested_days = v_days, status = 'pending_approval', submitted_by = auth.uid(),
    submitted_at = now()
  where id = p_request_id;
  select coalesce(full_name, email, 'Employee') into v_name from public.profiles where id = v_request.profile_id;
  v_body := 'Vacation request awaiting approval' || E'\n' || v_name || ' · ' ||
    replace(v_request.leave_type, '_', ' ') || ' · ' || v_request.start_date || ' to ' ||
    v_request.end_date || ' · ' || v_days || ' day(s)';
  perform public.leave_audit(p_request_id, 'leave_request_submitted', 'Vacation request submitted',
    jsonb_build_object('leaveType', v_request.leave_type, 'startDate', v_request.start_date, 'endDate', v_request.end_date, 'requestedDays', v_days));
  perform public.leave_notify_system_owners(v_body, '/hr?leaveRequest=' || p_request_id, v_request.profile_id);
end;
$$;

create or replace function public.cancel_my_leave_request(
  p_request_id uuid,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public
as $$
declare
  v_request public.leave_requests%rowtype;
  v_body text;
begin
  if not public.leave_actor_is_active() then raise exception 'Permission denied.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or v_request.profile_id <> auth.uid() then raise exception 'Vacation request not found.'; end if;
  if v_request.status = 'cancelled' then return; end if;
  if v_request.status not in ('draft', 'pending_approval') then raise exception 'This request cannot be cancelled by the employee.'; end if;
  update public.leave_requests set status = 'cancelled', cancelled_by = auth.uid(),
    cancelled_at = now(), cancellation_reason = nullif(btrim(p_reason), '')
  where id = p_request_id;
  v_body := 'Vacation request cancelled' || E'\n' || v_request.start_date || ' to ' || v_request.end_date;
  perform public.leave_audit(p_request_id, 'leave_request_cancelled', 'Vacation request cancelled',
    jsonb_build_object('previousStatus', v_request.status));
  perform public.leave_notify(v_request.profile_id, v_body, '/settings/profile/vacation-requests?request=' || p_request_id);
  perform public.leave_notify_system_owners(v_body, '/hr?leaveRequest=' || p_request_id, v_request.profile_id);
end;
$$;

create or replace function public.remind_leave_request(p_request_id uuid)
returns timestamptz language plpgsql security definer set search_path = public
as $$
declare
  v_request public.leave_requests%rowtype;
  v_next timestamptz;
  v_name text;
  v_body text;
begin
  if not public.leave_actor_is_active() then raise exception 'Permission denied.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or v_request.profile_id <> auth.uid() then raise exception 'Vacation request not found.'; end if;
  if v_request.status <> 'pending_approval' then raise exception 'Only pending requests can send reminders.'; end if;
  v_next := v_request.last_reminder_at + interval '24 hours';
  if v_request.last_reminder_at is not null and v_next > now() then
    raise exception 'Next reminder is available at %.', v_next;
  end if;
  update public.leave_requests set last_reminder_at = now() where id = p_request_id;
  select coalesce(full_name, email, 'Employee') into v_name from public.profiles where id = v_request.profile_id;
  v_body := 'Vacation approval reminder' || E'\n' || v_name || ' · ' || v_request.start_date || ' to ' || v_request.end_date;
  perform public.leave_audit(p_request_id, 'leave_request_reminder_sent', 'Vacation approval reminder sent', '{}');
  perform public.leave_notify_system_owners(v_body, '/hr?leaveRequest=' || p_request_id, v_request.profile_id);
  return now() + interval '24 hours';
end;
$$;

create or replace function public.approve_leave_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_request public.leave_requests%rowtype;
  v_hr public.profiles_hr%rowtype;
  v_days numeric;
  v_deduct numeric;
  v_balance numeric;
  v_entry_id uuid;
  v_entry jsonb;
  v_body text;
begin
  if not public.leave_actor_is_system_owner() then raise exception 'Only an active System Owner may approve vacation requests.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found then raise exception 'Vacation request not found.'; end if;
  if v_request.status = 'approved' then return; end if;
  if v_request.status <> 'pending_approval' then raise exception 'Only pending requests can be approved.'; end if;
  if v_request.profile_id = auth.uid() then raise exception 'Self-approval is not permitted.'; end if;
  v_days := public.leave_request_days(v_request.start_date, v_request.end_date, v_request.duration_type);
  select * into v_hr from public.profiles_hr where profile_id = v_request.profile_id for update;
  if not found then raise exception 'The employee HR leave record does not exist.'; end if;
  if v_request.approved_vacation_entry_id is not null or v_request.balance_deducted <> 0 then
    raise exception 'This request already has approval effects.';
  end if;
  if public.leave_request_has_overlap(v_request.profile_id, v_request.start_date, v_request.end_date, v_request.id) then
    raise exception 'These dates overlap an existing pending or approved vacation.';
  end if;
  v_balance := v_hr.annual_leave_days - v_hr.leave_taken_this_year;
  v_deduct := case when v_request.leave_type = 'annual_leave' then v_days else 0 end;
  if v_deduct > v_balance then raise exception 'Insufficient annual leave balance.'; end if;
  v_entry_id := gen_random_uuid();
  v_entry := jsonb_build_object(
    'id', v_entry_id, 'start_date', v_request.start_date::text,
    'end_date', v_request.end_date::text,
    'note', replace(v_request.leave_type, '_', ' ')
  );
  update public.profiles_hr set
    vacation_dates = coalesce(vacation_dates, '[]'::jsonb) || jsonb_build_array(v_entry),
    leave_taken_this_year = leave_taken_this_year + v_deduct,
    updated_by = auth.uid()
  where profile_id = v_request.profile_id;
  update public.leave_requests set
    requested_days = v_days, status = 'approved', approved_by = auth.uid(), approved_at = now(),
    approved_vacation_entry_id = v_entry_id, balance_deducted = v_deduct
  where id = p_request_id;
  v_balance := v_balance - v_deduct;
  v_body := 'Vacation request approved' || E'\n' || v_request.start_date || ' to ' ||
    v_request.end_date || ' · ' || v_days || ' day(s) · Remaining balance: ' || v_balance;
  perform public.leave_audit(p_request_id, 'leave_request_approved', 'Vacation request approved',
    jsonb_build_object('leaveType', v_request.leave_type, 'startDate', v_request.start_date, 'endDate', v_request.end_date, 'requestedDays', v_days));
  perform public.leave_audit(p_request_id, 'vacation_entry_created', 'Approved vacation entry created',
    jsonb_build_object('vacationEntryId', v_entry_id, 'startDate', v_request.start_date, 'endDate', v_request.end_date));
  if v_deduct > 0 then
    perform public.leave_audit(p_request_id, 'leave_balance_deducted', 'Annual leave balance deducted',
      jsonb_build_object('days', v_deduct, 'remainingBalance', v_balance));
  end if;
  perform public.leave_notify(v_request.profile_id, v_body, '/settings/profile/vacation-requests?request=' || p_request_id);
end;
$$;

create or replace function public.reject_leave_request(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_request public.leave_requests%rowtype;
begin
  if not public.leave_actor_is_system_owner() then raise exception 'Only an active System Owner may reject vacation requests.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A rejection reason is required.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found then raise exception 'Vacation request not found.'; end if;
  if v_request.status = 'rejected' then return; end if;
  if v_request.status <> 'pending_approval' then raise exception 'Only pending requests can be rejected.'; end if;
  update public.leave_requests set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(),
    decision_reason = btrim(p_reason) where id = p_request_id;
  perform public.leave_audit(p_request_id, 'leave_request_rejected', 'Vacation request rejected', '{}');
  perform public.leave_notify(v_request.profile_id,
    'Vacation request rejected' || E'\n' || btrim(p_reason),
    '/settings/profile/vacation-requests?request=' || p_request_id);
end;
$$;

create or replace function public.return_leave_request(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_request public.leave_requests%rowtype;
begin
  if not public.leave_actor_is_system_owner() then raise exception 'Only an active System Owner may return vacation requests.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A return reason is required.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found then raise exception 'Vacation request not found.'; end if;
  if v_request.status = 'returned' then return; end if;
  if v_request.status <> 'pending_approval' then raise exception 'Only pending requests can be returned.'; end if;
  update public.leave_requests set status = 'returned', returned_by = auth.uid(), returned_at = now(),
    return_reason = btrim(p_reason) where id = p_request_id;
  perform public.leave_audit(p_request_id, 'leave_request_returned', 'Vacation request returned for changes', '{}');
  perform public.leave_notify(v_request.profile_id,
    'Vacation request needs changes' || E'\n' || btrim(p_reason),
    '/settings/profile/vacation-requests?request=' || p_request_id);
end;
$$;

create or replace function public.cancel_approved_leave_request(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_request public.leave_requests%rowtype;
  v_hr public.profiles_hr%rowtype;
  v_found boolean;
  v_new_dates jsonb;
  v_body text;
begin
  if not public.leave_actor_is_system_owner() then raise exception 'Only an active System Owner may cancel approved leave.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A cancellation reason is required.'; end if;
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found then raise exception 'Vacation request not found.'; end if;
  if v_request.status = 'cancelled' then return; end if;
  if v_request.status <> 'approved' then raise exception 'Only approved leave can use approved cancellation.'; end if;
  if v_request.approved_vacation_entry_id is null then raise exception 'Approved vacation linkage is missing.'; end if;
  select * into v_hr from public.profiles_hr where profile_id = v_request.profile_id for update;
  if not found then raise exception 'The employee HR leave record does not exist.'; end if;
  select exists (
    select 1 from jsonb_array_elements(coalesce(v_hr.vacation_dates, '[]'::jsonb)) e
    where e->>'id' = v_request.approved_vacation_entry_id::text
  ) into v_found;
  if not v_found then raise exception 'The linked approved vacation entry was not found.'; end if;
  if v_hr.leave_taken_this_year < v_request.balance_deducted then
    raise exception 'Leave balance cannot be restored safely.';
  end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_new_dates
  from jsonb_array_elements(coalesce(v_hr.vacation_dates, '[]'::jsonb)) e
  where e->>'id' <> v_request.approved_vacation_entry_id::text;
  update public.profiles_hr set vacation_dates = v_new_dates,
    leave_taken_this_year = leave_taken_this_year - v_request.balance_deducted,
    updated_by = auth.uid() where profile_id = v_request.profile_id;
  update public.leave_requests set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
    cancellation_reason = btrim(p_reason) where id = p_request_id;
  v_body := 'Approved vacation cancelled' || E'\n' || btrim(p_reason);
  perform public.leave_audit(p_request_id, 'leave_request_cancelled', 'Approved vacation cancelled', '{}');
  if v_request.balance_deducted > 0 then
    perform public.leave_audit(p_request_id, 'leave_balance_restored', 'Annual leave balance restored',
      jsonb_build_object('days', v_request.balance_deducted));
  end if;
  perform public.leave_notify(v_request.profile_id, v_body,
    '/settings/profile/vacation-requests?request=' || p_request_id);
  perform public.leave_notify_system_owners(v_body, '/hr?leaveRequest=' || p_request_id, v_request.profile_id);
end;
$$;

revoke all on function public.leave_request_days(date,date,text) from public;
revoke all on function public.leave_actor_is_active() from public;
revoke all on function public.leave_actor_is_system_owner() from public;
revoke all on function public.leave_request_has_overlap(uuid,date,date,uuid) from public;
revoke all on function public.leave_audit(uuid,text,text,jsonb) from public;
revoke all on function public.leave_notify(uuid,text,text) from public;
revoke all on function public.leave_notify_system_owners(text,text,uuid) from public;
revoke all on function public.create_leave_request(text,date,date,text,text,text) from public;
revoke all on function public.update_leave_request(uuid,text,date,date,text,text,text) from public;
revoke all on function public.submit_leave_request(uuid) from public;
revoke all on function public.cancel_my_leave_request(uuid,text) from public;
revoke all on function public.remind_leave_request(uuid) from public;
revoke all on function public.approve_leave_request(uuid) from public;
revoke all on function public.reject_leave_request(uuid,text) from public;
revoke all on function public.return_leave_request(uuid,text) from public;
revoke all on function public.cancel_approved_leave_request(uuid,text) from public;

grant execute on function public.create_leave_request(text,date,date,text,text,text) to authenticated;
grant execute on function public.update_leave_request(uuid,text,date,date,text,text,text) to authenticated;
grant execute on function public.submit_leave_request(uuid) to authenticated;
grant execute on function public.cancel_my_leave_request(uuid,text) to authenticated;
grant execute on function public.remind_leave_request(uuid) to authenticated;
grant execute on function public.approve_leave_request(uuid) to authenticated;
grant execute on function public.reject_leave_request(uuid,text) to authenticated;
grant execute on function public.return_leave_request(uuid,text) to authenticated;
grant execute on function public.cancel_approved_leave_request(uuid,text) to authenticated;
