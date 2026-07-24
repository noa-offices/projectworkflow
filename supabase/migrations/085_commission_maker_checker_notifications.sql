-- Commission maker-checker enforcement and transactional workflow notifications.
-- Migration 084 is already applied; keep this as a forward-only repair.

create or replace function public.recalculate_sales_commission(
  p_commission_id uuid,
  p_rule_id uuid,
  p_base_override numeric,
  p_percentage_rate_override numeric,
  p_fixed_amount_override numeric,
  p_final_amount_override numeric,
  p_override_reason text,
  p_management_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  commission_record public.sales_commissions%rowtype;
  rule_record public.sales_commission_rules%rowtype;
  calculation jsonb;
  effective_calculation jsonb;
  original_basis numeric(14,2);
  effective_basis numeric(14,2);
  effective_rate numeric(9,4);
  effective_fixed numeric(14,2);
  final_amount numeric(14,2);
  existing_final_override numeric(14,2);
  calculation_error text;
  has_override boolean;
  financial_change boolean;
  actor_name text;
  actor_role text;
begin
  actor_role := public.current_user_role()::text;
  if
    actor_role not in ('system_owner', 'admin_manager')
    or public.current_account_status() is distinct from 'active'
  then
    raise exception 'Only the System Owner or an Admin Manager can edit commission calculations.';
  end if;

  select *
  into commission_record
  from public.sales_commissions
  where id = p_commission_id
  for update;

  if commission_record.id is null then
    raise exception 'Commission record was not found.';
  end if;

  if commission_record.status not in ('draft', 'requires_review') then
    raise exception 'Only Draft or Requires Review commissions can be recalculated.';
  end if;

  select *
  into rule_record
  from public.sales_commission_rules
  where id = p_rule_id
    and salesperson_id = commission_record.salesperson_id
    and effective_from <= commission_record.earned_at
    and (effective_to is null or commission_record.earned_at < effective_to);

  if rule_record.id is null then
    raise exception 'Select a rule effective on the commission earning date.';
  end if;

  if p_base_override is not null
    and rule_record.formula_type not in ('percentage', 'tiered_percentage', 'percentage_plus_fixed')
  then
    raise exception 'This formula does not use a commissionable-base override.';
  end if;

  if p_percentage_rate_override is not null
    and rule_record.formula_type not in ('percentage', 'tiered_percentage', 'percentage_plus_fixed')
  then
    raise exception 'This formula does not use a percentage-rate override.';
  end if;

  if p_fixed_amount_override is not null
    and rule_record.formula_type not in ('fixed_amount', 'percentage_plus_fixed')
  then
    raise exception 'This formula does not use a fixed-amount override.';
  end if;

  original_basis := case rule_record.basis_type
    when 'approved_total_including_vat' then commission_record.approved_total_including_vat
    when 'approved_total_excluding_vat' then commission_record.approved_total_excluding_vat
    else null
  end;
  effective_basis := coalesce(p_base_override, original_basis);
  effective_rate := coalesce(p_percentage_rate_override, rule_record.percentage_rate);
  effective_fixed := coalesce(p_fixed_amount_override, rule_record.fixed_amount);
  existing_final_override := case
    when commission_record.override_reason is not null
      and commission_record.final_commission_amount
        is distinct from commission_record.percentage_component + commission_record.fixed_component
    then commission_record.final_commission_amount
    else null
  end;
  has_override :=
    p_base_override is not null
    or p_percentage_rate_override is not null
    or p_fixed_amount_override is not null
    or p_final_amount_override is not null;
  financial_change :=
    p_rule_id is distinct from commission_record.rule_id
    or p_base_override is distinct from commission_record.commissionable_base_override
    or p_percentage_rate_override is distinct from commission_record.percentage_rate_override
    or p_fixed_amount_override is distinct from commission_record.fixed_amount_override
    or p_final_amount_override is distinct from existing_final_override;

  if financial_change and nullif(btrim(p_override_reason), '') is null then
    raise exception 'An override reason is required for financial changes.';
  end if;

  calculation := public.calculate_sales_commission_values(
    rule_record.formula_type,
    original_basis,
    commission_record.currency,
    rule_record.percentage_rate,
    rule_record.fixed_amount,
    rule_record.fixed_amount_currency,
    rule_record.tier_configuration,
    rule_record.tier_method
  );

  effective_calculation := public.calculate_sales_commission_values(
    rule_record.formula_type,
    effective_basis,
    commission_record.currency,
    effective_rate,
    effective_fixed,
    rule_record.fixed_amount_currency,
    rule_record.tier_configuration,
    rule_record.tier_method
  );

  calculation_error := nullif(effective_calculation ->> 'error', '');
  final_amount := coalesce(
    p_final_amount_override,
    (effective_calculation ->> 'original_calculated_amount')::numeric
  );

  update public.sales_commissions
  set
    rule_id = rule_record.id,
    formula_type_snapshot = rule_record.formula_type,
    basis_type_snapshot = rule_record.basis_type,
    formula_configuration_snapshot = jsonb_build_object(
      'formula_type', rule_record.formula_type,
      'basis_type', rule_record.basis_type,
      'percentage_rate', rule_record.percentage_rate,
      'fixed_amount', rule_record.fixed_amount,
      'fixed_amount_currency', rule_record.fixed_amount_currency,
      'tier_configuration', rule_record.tier_configuration,
      'tier_method', rule_record.tier_method
    ),
    percentage_rate_snapshot = rule_record.percentage_rate,
    fixed_amount_snapshot = rule_record.fixed_amount,
    fixed_amount_currency_snapshot = rule_record.fixed_amount_currency,
    tier_configuration_snapshot = rule_record.tier_configuration,
    tier_method_snapshot = rule_record.tier_method,
    matched_tier_snapshot = effective_calculation -> 'matched_tier',
    commissionable_base = original_basis,
    commissionable_base_override = p_base_override,
    percentage_rate_override = p_percentage_rate_override,
    fixed_amount_override = p_fixed_amount_override,
    percentage_component =
      coalesce((effective_calculation ->> 'percentage_component')::numeric, 0),
    fixed_component =
      coalesce((effective_calculation ->> 'fixed_component')::numeric, 0),
    original_calculated_amount =
      coalesce((calculation ->> 'original_calculated_amount')::numeric, 0),
    final_commission_amount =
      case when calculation_error is null then final_amount else 0 end,
    status = case when calculation_error is null then 'draft' else 'requires_review' end,
    review_reason = calculation_error,
    override_reason = case
      when financial_change then nullif(btrim(p_override_reason), '')
      when has_override then commission_record.override_reason
      else null
    end,
    overridden_by = case when financial_change then auth.uid() else commission_record.overridden_by end,
    overridden_at = case when financial_change then now() else commission_record.overridden_at end,
    management_notes = nullif(btrim(p_management_notes), '')
  where id = commission_record.id;

  select coalesce(nullif(btrim(full_name), ''), email, id::text)
  into actor_name
  from public.profiles
  where id = auth.uid();

  insert into public.audit_activity_log (
    entity_type,
    entity_id,
    action,
    title,
    description,
    metadata,
    created_by
  )
  values (
    'sales_commission',
    commission_record.id,
    case when financial_change then 'commission_overridden' else 'commission_recalculated' end,
    case when financial_change then 'Commission overridden' else 'Commission recalculated' end,
    case when financial_change then nullif(btrim(p_override_reason), '') else null end,
    jsonb_build_object(
      'ruleId', rule_record.id,
      'status', case when calculation_error is null then 'draft' else 'requires_review' end,
      'actorName', actor_name,
      'actorRole', actor_role
    ),
    auth.uid()
  );

  return commission_record.id;
end;
$$;

create or replace function public.transition_sales_commission(
  p_commission_id uuid,
  p_target_status text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  commission_record public.sales_commissions%rowtype;
  audit_action text;
  audit_title text;
  actor_name text;
  actor_role text;
  manager_name text;
  event_body text;
  event_link text;
begin
  actor_role := public.current_user_role()::text;
  if
    public.current_account_status() is distinct from 'active'
    or actor_role not in ('system_owner', 'admin_manager', 'sales_designer')
  then
    raise exception 'You do not have permission to change commission workflow status.';
  end if;

  select *
  into commission_record
  from public.sales_commissions
  where id = p_commission_id
  for update;

  if commission_record.id is null then
    raise exception 'Commission record was not found.';
  end if;

  if actor_role = 'sales_designer' and commission_record.salesperson_id <> auth.uid() then
    raise exception 'Sales Managers can submit only their own commission records.';
  end if;

  if not (
    (commission_record.status = 'draft' and p_target_status in ('pending_approval', 'cancelled'))
    or (commission_record.status = 'pending_approval' and p_target_status in ('draft', 'approved', 'cancelled'))
    or (commission_record.status = 'approved' and p_target_status in ('paid', 'reversed'))
    or (commission_record.status = 'paid' and p_target_status = 'reversed')
  ) then
    raise exception 'That commission status transition is not allowed.';
  end if;

  if p_target_status <> 'pending_approval' and actor_role <> 'system_owner' then
    raise exception 'Only the System Owner can perform this commission action.';
  end if;

  if p_target_status in ('draft', 'cancelled', 'reversed')
    and nullif(btrim(p_reason), '') is null
  then
    raise exception 'A reason is required for this status change.';
  end if;

  if p_target_status = 'pending_approval' then
    if commission_record.review_reason is not null then
      raise exception 'Resolve the review issue before submitting this commission.';
    end if;
    if commission_record.overridden_by = auth.uid() then
      raise exception 'Maker-checker control: the last financial editor cannot submit this commission.';
    end if;
    if commission_record.rule_id is null
      or commission_record.formula_type_snapshot is null
      or commission_record.final_commission_amount < 0
      or nullif(btrim(commission_record.currency), '') is null
    then
      raise exception 'The commission calculation is incomplete and cannot be submitted.';
    end if;
  end if;

  if p_target_status = 'approved' then
    if (
      select count(*)
      from public.profiles
      where role = 'system_owner'
        and account_status = 'active'
    ) < 2 then
      raise exception 'Approval requires another active System Owner for maker-checker control.';
    end if;
    if commission_record.submitted_by is null then
      raise exception 'The commission has no recorded submitter and cannot be approved.';
    end if;
    if commission_record.cancelled_at is not null or commission_record.reversed_at is not null then
      raise exception 'Cancelled or reversed commission records cannot be approved.';
    end if;
    if commission_record.review_reason is not null
      or commission_record.rule_id is null
      or commission_record.formula_type_snapshot is null
      or commission_record.final_commission_amount < 0
      or nullif(btrim(commission_record.currency), '') is null
    then
      raise exception 'The commission calculation is not valid for approval.';
    end if;
    if commission_record.submitted_by = auth.uid()
      or commission_record.overridden_by = auth.uid()
    then
      raise exception 'Maker-checker control: you cannot approve a commission you submitted or financially edited.';
    end if;
  end if;

  update public.sales_commissions
  set
    status = p_target_status,
    submitted_by = case when p_target_status = 'pending_approval' then auth.uid() else submitted_by end,
    submitted_at = case when p_target_status = 'pending_approval' then now() else submitted_at end,
    approved_by = case when p_target_status = 'approved' then auth.uid() else approved_by end,
    approved_at = case when p_target_status = 'approved' then now() else approved_at end,
    paid_by = case when p_target_status = 'paid' then auth.uid() else paid_by end,
    paid_at = case when p_target_status = 'paid' then now() else paid_at end,
    cancelled_by = case when p_target_status = 'cancelled' then auth.uid() else cancelled_by end,
    cancelled_at = case when p_target_status = 'cancelled' then now() else cancelled_at end,
    cancellation_reason = case
      when p_target_status = 'cancelled' then nullif(btrim(p_reason), '')
      else cancellation_reason
    end,
    reversed_by = case when p_target_status = 'reversed' then auth.uid() else reversed_by end,
    reversed_at = case when p_target_status = 'reversed' then now() else reversed_at end,
    reversal_reason = case
      when p_target_status = 'reversed' then nullif(btrim(p_reason), '')
      else reversal_reason
    end
  where id = commission_record.id;

  select coalesce(nullif(btrim(full_name), ''), email, id::text)
  into actor_name
  from public.profiles
  where id = auth.uid();

  select coalesce(nullif(btrim(full_name), ''), email, id::text)
  into manager_name
  from public.profiles
  where id = commission_record.salesperson_id;

  select action, title
  into audit_action, audit_title
  from (
    values
      ('pending_approval', 'commission_submitted', 'Commission submitted for approval'),
      ('draft', 'commission_returned_to_draft', 'Commission returned to Draft'),
      ('approved', 'commission_approved', 'Commission approved'),
      ('paid', 'commission_marked_paid', 'Commission marked paid'),
      ('cancelled', 'commission_cancelled', 'Commission cancelled'),
      ('reversed', 'commission_reversed', 'Commission reversed')
  ) as transitions(status, action, title)
  where status = p_target_status;

  insert into public.audit_activity_log (
    entity_type,
    entity_id,
    action,
    title,
    description,
    metadata,
    created_by
  )
  values (
    'sales_commission',
    commission_record.id,
    audit_action,
    audit_title,
    nullif(btrim(p_reason), ''),
    jsonb_build_object(
      'fromStatus', commission_record.status,
      'toStatus', p_target_status,
      'actorName', actor_name,
      'actorRole', actor_role
    ),
    auth.uid()
  );

  event_link := '/commissions/' || commission_record.id::text;
  event_body :=
    manager_name || ' · ' ||
    commission_record.quotation_folder_key || ' · ' ||
    commission_record.currency || ' ' || commission_record.final_commission_amount::text;

  if p_target_status = 'pending_approval' then
    insert into public.notifications (
      recipient_id, sender_id, body, order_no, sent_to_role, requires_response
    )
    select
      profiles.id,
      auth.uid(),
      'Commission awaiting approval — Action required' || E'\n' ||
        event_body || ' · Submitted by ' || actor_name,
      event_link,
      'system_owner',
      false
    from public.profiles
    where profiles.role = 'system_owner'
      and profiles.account_status = 'active'
      and profiles.id <> auth.uid();

    if commission_record.salesperson_id <> auth.uid() then
      insert into public.notifications (
        recipient_id, sender_id, body, order_no, sent_to_role, requires_response
      )
      values (
        commission_record.salesperson_id,
        auth.uid(),
        'Commission submitted for approval' || E'\n' || event_body || ' · Submitted by ' || actor_name,
        event_link,
        'sales_designer',
        false
      );

      insert into public.notifications (
        recipient_id, sender_id, body, order_no, sent_to_role, requires_response
      )
      values (
        auth.uid(),
        auth.uid(),
        'Commission submitted for approval' || E'\n' || event_body,
        event_link,
        actor_role,
        false
      );
    end if;
  elsif p_target_status in ('approved', 'draft', 'cancelled', 'paid', 'reversed') then
    insert into public.notifications (
      recipient_id, sender_id, body, order_no, sent_to_role, requires_response
    )
    select
      recipient_id,
      auth.uid(),
      case p_target_status
        when 'approved' then 'Commission approved' || E'\n' || event_body || ' · Approved by ' || actor_name
        when 'draft' then 'Commission returned for changes' || E'\n' || event_body || ' · ' || btrim(p_reason)
        when 'cancelled' then 'Commission cancelled' || E'\n' || event_body || ' · ' || btrim(p_reason)
        when 'paid' then 'Commission marked paid' || E'\n' || event_body || ' · Updated by ' || actor_name
        when 'reversed' then 'Commission reversed' || E'\n' || event_body || ' · ' || btrim(p_reason)
      end,
      event_link,
      null,
      false
    from (
      select distinct recipient_id
      from unnest(
        case p_target_status
          when 'paid' then array[
            commission_record.salesperson_id,
            commission_record.submitted_by
          ]::uuid[]
          when 'approved' then array[
            commission_record.salesperson_id,
            commission_record.submitted_by
          ]::uuid[]
          else array[
            commission_record.salesperson_id,
            commission_record.submitted_by,
            commission_record.overridden_by
          ]::uuid[]
        end
      ) as recipients(recipient_id)
      where recipient_id is not null
        and recipient_id <> auth.uid()
    ) as deduplicated_recipients;
  end if;

  return commission_record.id;
end;
$$;

revoke all on function public.recalculate_sales_commission(
  uuid, uuid, numeric, numeric, numeric, numeric, text, text
) from public, anon;
revoke all on function public.transition_sales_commission(uuid, text, text) from public, anon;

grant execute on function public.recalculate_sales_commission(
  uuid, uuid, numeric, numeric, numeric, numeric, text, text
) to authenticated;
grant execute on function public.transition_sales_commission(uuid, text, text) to authenticated;
