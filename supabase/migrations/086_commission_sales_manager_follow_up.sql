-- Sales Manager commission reminders, payment follow-up, and non-financial notes.

create or replace function public.record_sales_commission_user_event(
  p_commission_id uuid,
  p_action text,
  p_note text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  commission_record public.sales_commissions%rowtype;
  actor_name text;
  actor_role text;
  event_time timestamptz := now();
  last_event_at timestamptz;
  event_title text;
  notification_title text;
  notification_body text;
  clean_note text := nullif(btrim(p_note), '');
begin
  actor_role := public.current_user_role()::text;
  if public.current_account_status() is distinct from 'active'
    or actor_role <> 'sales_designer'
  then
    raise exception 'Only an active Sales Manager can perform this action.';
  end if;

  select * into commission_record
  from public.sales_commissions
  where id = p_commission_id
  for update;

  if commission_record.id is null or commission_record.salesperson_id <> auth.uid() then
    raise exception 'Sales Managers can act only on their own commission records.';
  end if;

  if p_action = 'commission_approval_reminder_sent' then
    if commission_record.status <> 'pending_approval' then
      raise exception 'Approval reminders are available only while a commission is Pending Approval.';
    end if;
    event_title := 'Commission approval reminder sent';
    notification_title := 'Commission approval reminder';
  elsif p_action = 'commission_payment_update_requested' then
    if commission_record.status <> 'approved' then
      raise exception 'Payment updates can be requested only for an Approved commission.';
    end if;
    event_title := 'Commission payment update requested';
    notification_title := 'Commission payment update requested';
  elsif p_action = 'commission_sales_manager_note_added' then
    if commission_record.status in ('cancelled', 'reversed') then
      raise exception 'Notes cannot be added to Cancelled or Reversed commissions.';
    end if;
    if clean_note is null then
      raise exception 'Enter a note.';
    end if;
    if length(clean_note) > 2000 then
      raise exception 'The note must be 2,000 characters or fewer.';
    end if;
    event_title := 'Sales Manager note added';
  else
    raise exception 'Unsupported commission action.';
  end if;

  if p_action in ('commission_approval_reminder_sent', 'commission_payment_update_requested') then
    select max(created_at) into last_event_at
    from public.audit_activity_log
    where entity_type = 'sales_commission'
      and entity_id = commission_record.id
      and action = p_action;

    if last_event_at is not null and last_event_at > event_time - interval '24 hours' then
      raise exception 'A reminder was already sent recently. You can send another reminder after %.',
        to_char(last_event_at + interval '24 hours', 'YYYY-MM-DD HH24:MI TZ');
    end if;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, id::text)
  into actor_name
  from public.profiles
  where id = auth.uid();

  insert into public.audit_activity_log (
    entity_type, entity_id, action, title, description, metadata, created_by, created_at
  ) values (
    'sales_commission', commission_record.id, p_action, event_title, clean_note,
    jsonb_build_object('actorName', actor_name, 'actorRole', actor_role),
    auth.uid(), event_time
  );

  if notification_title is not null then
    notification_body := notification_title || E'\n' ||
      actor_name || ' · ' || commission_record.quotation_folder_key || ' · ' ||
      commission_record.currency || ' ' || commission_record.final_commission_amount::text ||
      case
        when p_action = 'commission_approval_reminder_sent'
          then ' · Submitted ' || coalesce(to_char(commission_record.submitted_at, 'YYYY-MM-DD HH24:MI TZ'), '—')
        else ' · Approved ' || coalesce(to_char(commission_record.approved_at, 'YYYY-MM-DD HH24:MI TZ'), '—')
      end;

    insert into public.notifications (
      recipient_id, sender_id, body, order_no, sent_to_role, requires_response
    )
    select distinct
      profiles.id, auth.uid(), notification_body,
      '/commissions/' || commission_record.id::text, 'system_owner', false
    from public.profiles
    where profiles.role = 'system_owner'
      and profiles.account_status = 'active'
      and profiles.id <> auth.uid();
  end if;

  return event_time;
end;
$$;

revoke all on function public.record_sales_commission_user_event(uuid, text, text) from public, anon;
grant execute on function public.record_sales_commission_user_event(uuid, text, text) to authenticated;
