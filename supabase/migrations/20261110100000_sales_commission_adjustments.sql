begin;

-- D2: additive ledger only. No backfill, original commission edits or replacement functions.
create table public.sales_commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.sales_commissions(id) on delete restrict,
  variation_id uuid not null unique references public.project_variations(id) on delete restrict,
  variation_no integer not null check (variation_no > 0),
  formula_type_snapshot text,
  basis_type_snapshot text,
  percentage_rate_snapshot numeric(9,4),
  fixed_amount_snapshot numeric(14,2),
  fixed_amount_currency_snapshot text,
  tier_configuration_snapshot jsonb,
  tier_method_snapshot text,
  currency text not null check (btrim(currency) <> ''),
  previous_base numeric(14,2) check (previous_base >= 0),
  new_base numeric(14,2) check (new_base >= 0),
  previous_entitlement numeric(14,2) check (previous_entitlement >= 0),
  new_entitlement numeric(14,2) check (new_entitlement >= 0),
  adjustment_amount numeric(14,2),
  status text not null check (status in ('draft','requires_review','pending_approval','approved','paid','cancelled','reversed')),
  review_reason text,
  created_by uuid references public.profiles(id) on delete restrict,
  recalculated_by uuid references public.profiles(id) on delete restrict,
  recalculated_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  paid_by uuid references public.profiles(id) on delete restrict,
  paid_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  cancellation_reason text,
  reversed_by uuid references public.profiles(id) on delete restrict,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (adjustment_amount is not distinct from (new_entitlement - previous_entitlement)),
  check (status in ('requires_review','cancelled') or
    (review_reason is null and adjustment_amount is not null and previous_entitlement is not null and new_entitlement is not null))
);
create index sales_commission_adjustments_parent_idx on public.sales_commission_adjustments(commission_id, variation_no);
alter table public.sales_commission_adjustments enable row level security;
-- Parent RLS is the sole read authority; viewers and other salespeople see nothing.
create policy sales_commission_adjustments_read on public.sales_commission_adjustments
for select to authenticated using (exists (
  select 1 from public.sales_commissions c where c.id = commission_id
));
revoke all on public.sales_commission_adjustments from public, anon, authenticated, service_role;
grant select on public.sales_commission_adjustments to authenticated;

create function public.guard_sales_commission_adjustment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op in ('DELETE','TRUNCATE') then
    raise exception 'Commission adjustment history cannot be deleted.';
  end if;
  if new.id <> old.id or new.commission_id <> old.commission_id or new.variation_id <> old.variation_id
    or new.variation_no <> old.variation_no or new.created_at <> old.created_at
    or new.created_by is distinct from old.created_by then
    raise exception 'Commission adjustment identity cannot be changed.';
  end if;
  if new.status <> old.status and not (
    (old.status = 'requires_review' and new.status = 'draft')
    or (old.status = 'draft' and new.status in ('pending_approval','cancelled'))
    or (old.status = 'pending_approval' and new.status in ('draft','approved','cancelled'))
    or (old.status = 'approved' and new.status in ('paid','reversed'))
    or (old.status = 'paid' and new.status = 'reversed')
  ) then raise exception 'That commission status transition is not allowed.'; end if;
  if (to_jsonb(new) - array['status','submitted_by','submitted_at','approved_by','approved_at','paid_by','paid_at',
      'cancelled_by','cancelled_at','cancellation_reason','reversed_by','reversed_at','reversal_reason','updated_at'])
    is distinct from
    (to_jsonb(old) - array['status','submitted_by','submitted_at','approved_by','approved_at','paid_by','paid_at',
      'cancelled_by','cancelled_at','cancellation_reason','reversed_by','reversed_at','reversal_reason','updated_at'])
    and not (old.status = 'requires_review' and new.status in ('requires_review','draft')) then
    raise exception 'Commission adjustment financial values cannot be changed.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger sales_commission_adjustments_guard before update or delete on public.sales_commission_adjustments
for each row execute function public.guard_sales_commission_adjustment();
create trigger sales_commission_adjustments_no_truncate before truncate on public.sales_commission_adjustments
for each statement execute function public.guard_sales_commission_adjustment();
revoke all on function public.guard_sales_commission_adjustment() from public, anon, authenticated, service_role;

create function public.generate_sales_commission_adjustment(p_variation_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.project_variations%rowtype;
  prior public.project_variations%rowtype;
  parent public.sales_commissions%rowtype;
  approval public.sales_approval_snapshots%rowtype;
  existing public.sales_commission_adjustments%rowtype;
  previous_base numeric(14,2);
  new_base numeric(14,2);
  previous_calc jsonb;
  new_calc jsonb;
  previous_amount numeric(14,2);
  new_amount numeric(14,2);
  reason text;
  result_id uuid;
begin
  -- Only the trusted AFTER INSERT trigger bypasses the explicit System Owner RPC gate.
  -- No client has INSERT privilege on project_variations or EXECUTE on the trigger function.
  if pg_trigger_depth() = 0 and (auth.uid() is null
    or public.current_account_status() is distinct from 'active'
    or public.current_user_role()::text is distinct from 'system_owner') then
    raise exception 'Only the System Owner can generate commission adjustments.';
  end if;
  -- Serialize by variation; concurrent explicit calls return the same unique ledger row.
  select * into v from public.project_variations where id = p_variation_id for update;
  if not found then raise exception 'Applied variation was not found.'; end if;
  select * into existing from public.sales_commission_adjustments where variation_id = v.id for update;
  if existing.id is not null and existing.status <> 'requires_review' then return existing.id; end if;

  select c.* into parent from public.sales_commissions c
  join public.sales_approval_snapshots a on a.id = c.approval_snapshot_id
  join public.project_snapshots s on s.quotation_id = a.quotation_id
  where s.id = v.snapshot_id for share of c;
  if parent.id is null then
    insert into public.audit_activity_log(entity_type,entity_id,action,title,metadata,created_by)
    values ('project_variation',v.id,'commission_adjustment_parent_missing','Commission adjustment needs an original commission',
      jsonb_build_object('variationId',v.id,'variationNo',v.variation_no),auth.uid());
    return null;
  end if;
  select * into approval from public.sales_approval_snapshots where id = parent.approval_snapshot_id;
  select * into prior from public.project_variations
  where snapshot_id = v.snapshot_id and variation_no < v.variation_no order by variation_no desc limit 1;

  if parent.basis_type_snapshot = 'approved_total_including_vat' then
    previous_base := case when prior.id is null then approval.source_total else prior.new_contract_total end;
    new_base := v.new_contract_total;
  elsif parent.basis_type_snapshot = 'approved_total_excluding_vat' then
    previous_base := case when prior.id is null then approval.amount_excluding_vat else prior.new_contract_total - prior.vat_amount end;
    new_base := v.new_contract_total - v.vat_amount;
  end if;

  if parent.status in ('cancelled','reversed','requires_review') then
    reason := 'The original commission is ' || replace(parent.status,'_',' ') || '.';
  elsif parent.commissionable_base_override is not null or parent.percentage_rate_override is not null
    or parent.fixed_amount_override is not null
    or parent.overridden_by is not null or nullif(btrim(parent.override_reason),'') is not null then
    reason := 'The original commission has a manual override. An adjustment policy must be reviewed.';
  elsif parent.rule_id is null or parent.formula_type_snapshot is null then
    reason := 'The original commission has no copied rule.';
  elsif upper(parent.currency) <> upper(v.currency) or upper(parent.currency) <> upper(approval.currency)
    or (prior.id is not null and upper(parent.currency) <> upper(prior.currency)) then
    reason := 'The scope currencies do not match the original commission.';
  elsif parent.formula_type_snapshot not in ('fixed_amount','none') and
    (previous_base is null or new_base is null or previous_base < 0 or new_base < 0) then
    reason := 'A required scope VAT or commission base is missing or invalid.';
  end if;
  -- Keep unavailable financial values NULL, never pretend an unresolved adjustment is zero.
  if previous_base < 0 then previous_base := null; end if;
  if new_base < 0 then new_base := null; end if;
  if reason is null then
    previous_calc := public.calculate_sales_commission_values(parent.formula_type_snapshot,previous_base,parent.currency,
      parent.percentage_rate_snapshot,parent.fixed_amount_snapshot,parent.fixed_amount_currency_snapshot,
      parent.tier_configuration_snapshot,parent.tier_method_snapshot);
    new_calc := public.calculate_sales_commission_values(parent.formula_type_snapshot,new_base,parent.currency,
      parent.percentage_rate_snapshot,parent.fixed_amount_snapshot,parent.fixed_amount_currency_snapshot,
      parent.tier_configuration_snapshot,parent.tier_method_snapshot);
    reason := coalesce(nullif(previous_calc->>'error',''),nullif(new_calc->>'error',''));
    if reason is null then
      previous_amount := (previous_calc->>'original_calculated_amount')::numeric;
      new_amount := (new_calc->>'original_calculated_amount')::numeric;
    end if;
  end if;
  if reason is null and new_amount = previous_amount and existing.id is null then
    insert into public.audit_activity_log(entity_type,entity_id,action,title,metadata,created_by)
    values ('project_variation',v.id,'commission_adjustment_zero','No commission adjustment: entitlement unchanged',
      jsonb_build_object('commissionId',parent.id,'previousBase',previous_base,'newBase',new_base),auth.uid());
    return null;
  end if;
  -- A requires_review row that resolves to zero is retained as cancelled history.
  insert into public.sales_commission_adjustments as a (
    commission_id,variation_id,variation_no,formula_type_snapshot,basis_type_snapshot,percentage_rate_snapshot,
    fixed_amount_snapshot,fixed_amount_currency_snapshot,tier_configuration_snapshot,tier_method_snapshot,currency,
    previous_base,new_base,previous_entitlement,new_entitlement,adjustment_amount,status,review_reason,created_by)
  values (parent.id,v.id,v.variation_no,parent.formula_type_snapshot,parent.basis_type_snapshot,parent.percentage_rate_snapshot,
    parent.fixed_amount_snapshot,parent.fixed_amount_currency_snapshot,parent.tier_configuration_snapshot,parent.tier_method_snapshot,parent.currency,
    previous_base,new_base,previous_amount,new_amount,new_amount-previous_amount,
    case when reason is not null then 'requires_review' else 'draft' end,reason,auth.uid())
  on conflict (variation_id) do update set
    formula_type_snapshot = excluded.formula_type_snapshot,basis_type_snapshot = excluded.basis_type_snapshot,
    percentage_rate_snapshot = excluded.percentage_rate_snapshot,fixed_amount_snapshot = excluded.fixed_amount_snapshot,
    fixed_amount_currency_snapshot = excluded.fixed_amount_currency_snapshot,tier_configuration_snapshot = excluded.tier_configuration_snapshot,
    tier_method_snapshot = excluded.tier_method_snapshot,currency = excluded.currency,
    previous_base = excluded.previous_base,new_base = excluded.new_base,previous_entitlement = excluded.previous_entitlement,
    new_entitlement = excluded.new_entitlement,adjustment_amount = excluded.adjustment_amount,status = excluded.status,
    review_reason = excluded.review_reason,recalculated_by = auth.uid(),recalculated_at = now()
  returning id into result_id;
  if reason is null and new_amount = previous_amount then
    update public.sales_commission_adjustments set status = 'cancelled',cancelled_by = auth.uid(),cancelled_at = now(),
      cancellation_reason = 'Review resolved: entitlement unchanged.' where id = result_id;
  end if;
  insert into public.audit_activity_log(entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by)
  values ('sales_commission_adjustment',result_id,'sales_commission',parent.id,
    'commission_adjustment_generated','Commission adjustment calculated',reason,
    jsonb_build_object('variationId',v.id,'variationNo',v.variation_no,'adjustmentAmount',new_amount-previous_amount),auth.uid());
  return result_id;
end;
$$;
revoke all on function public.generate_sales_commission_adjustment(uuid) from public, anon, authenticated, service_role;
grant execute on function public.generate_sales_commission_adjustment(uuid) to authenticated;

create function public.sales_commission_adjustment_after_variation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public.generate_sales_commission_adjustment(new.id);
  exception when others then
    -- A failed generation rolls back only its subtransaction, never the applied scope.
    begin
      insert into public.audit_activity_log(entity_type,entity_id,action,title,description,metadata,created_by)
      values ('project_variation',new.id,'commission_adjustment_generation_failed','Commission adjustment generation failed',
        SQLERRM,jsonb_build_object('variationId',new.id,'sqlstate',SQLSTATE),auth.uid());
    exception when others then
      raise warning 'Commission adjustment and failure audit could not be written for variation %: %',new.id,SQLERRM;
    end;
  end;
  return new;
end;
$$;
revoke all on function public.sales_commission_adjustment_after_variation() from public, anon, authenticated, service_role;
create trigger sales_commission_adjustment_on_variation after insert on public.project_variations
for each row execute function public.sales_commission_adjustment_after_variation();

create function public.transition_sales_commission_adjustment(p_adjustment_id uuid,p_target_status text,p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a public.sales_commission_adjustments%rowtype;
  parent public.sales_commissions%rowtype;
  actor_role text := public.current_user_role()::text;
begin
  if auth.uid() is null or public.current_account_status() is distinct from 'active'
    or actor_role is null or actor_role not in ('system_owner','admin_manager','sales_designer') then
    raise exception 'You do not have permission to change commission workflow status.';
  end if;
  select * into a from public.sales_commission_adjustments where id = p_adjustment_id for update;
  if a.id is null then raise exception 'Commission record was not found.'; end if;
  select * into parent from public.sales_commissions where id = a.commission_id for share;
  if actor_role = 'sales_designer' and parent.salesperson_id <> auth.uid() then
    raise exception 'Sales Managers can submit only their own commission records.';
  end if;
  if p_target_status is null or not (
    (a.status = 'draft' and p_target_status in ('pending_approval','cancelled'))
    or (a.status = 'pending_approval' and p_target_status in ('draft','approved','cancelled'))
    or (a.status = 'approved' and p_target_status in ('paid','reversed'))
    or (a.status = 'paid' and p_target_status = 'reversed')
  ) then raise exception 'That commission status transition is not allowed.'; end if;
  if p_target_status <> 'pending_approval' and actor_role <> 'system_owner' then
    raise exception 'Only the System Owner can perform this commission action.';
  end if;
  if p_target_status in ('draft','cancelled','reversed') and nullif(btrim(p_reason),'') is null then
    raise exception 'A reason is required for this status change.';
  end if;
  if p_target_status in ('pending_approval','approved') then
    if a.review_reason is not null or a.formula_type_snapshot is null or a.adjustment_amount is null
      or parent.status in ('cancelled','reversed','requires_review')
      or parent.commissionable_base_override is not null or parent.percentage_rate_override is not null
      or parent.fixed_amount_override is not null
      or parent.overridden_by is not null or nullif(btrim(parent.override_reason),'') is not null then
      raise exception 'The commission calculation is not valid for approval.';
    end if;
    if a.recalculated_by = auth.uid() then
      raise exception 'Maker-checker control: the last financial editor cannot submit or approve this commission.';
    end if;
  end if;
  if p_target_status = 'approved' then
    if (select count(*) from public.profiles where role = 'system_owner' and account_status = 'active') < 2 then
      raise exception 'Approval requires another active System Owner for maker-checker control.';
    end if;
    if a.submitted_by is null then raise exception 'The commission has no recorded submitter and cannot be approved.'; end if;
    if a.submitted_by = auth.uid() then
      raise exception 'Maker-checker control: you cannot approve a commission you submitted or financially edited.';
    end if;
  end if;
  update public.sales_commission_adjustments set status = p_target_status,
    submitted_by = case when p_target_status = 'pending_approval' then auth.uid() else submitted_by end,
    submitted_at = case when p_target_status = 'pending_approval' then now() else submitted_at end,
    approved_by = case when p_target_status = 'approved' then auth.uid() else approved_by end,
    approved_at = case when p_target_status = 'approved' then now() else approved_at end,
    paid_by = case when p_target_status = 'paid' then auth.uid() else paid_by end,
    paid_at = case when p_target_status = 'paid' then now() else paid_at end,
    cancelled_by = case when p_target_status = 'cancelled' then auth.uid() else cancelled_by end,
    cancelled_at = case when p_target_status = 'cancelled' then now() else cancelled_at end,
    cancellation_reason = case when p_target_status = 'cancelled' then btrim(p_reason) else cancellation_reason end,
    reversed_by = case when p_target_status = 'reversed' then auth.uid() else reversed_by end,
    reversed_at = case when p_target_status = 'reversed' then now() else reversed_at end,
    reversal_reason = case when p_target_status = 'reversed' then btrim(p_reason) else reversal_reason end
  where id = a.id;
  insert into public.audit_activity_log(entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by)
  values ('sales_commission_adjustment',a.id,'sales_commission',a.commission_id,
    'commission_adjustment_' || p_target_status,'Commission adjustment: ' || replace(p_target_status,'_',' '),nullif(btrim(p_reason),''),
    jsonb_build_object('fromStatus',a.status,'toStatus',p_target_status,'variationId',a.variation_id),auth.uid());
  -- The same recipients as the original workflow, with an explicit adjustment label.
  insert into public.notifications(recipient_id,sender_id,body,order_no,sent_to_role,requires_response)
  select p.id,auth.uid(),'Commission adjustment V' || a.variation_no || ': ' || replace(p_target_status,'_',' ')
    || E'\n' || parent.quotation_folder_key || ' ' || a.currency || ' ' || a.adjustment_amount::text
    || coalesce(E'\n' || nullif(btrim(p_reason),''),''),'/commissions/' || a.commission_id::text,p.role::text,false
  from public.profiles p where p.account_status = 'active' and (
    (p_target_status = 'pending_approval' and p.role = 'system_owner' and p.id <> auth.uid())
    or p.id = parent.salesperson_id or p.id = a.submitted_by
  );
  return a.id;
end;
$$;
revoke all on function public.transition_sales_commission_adjustment(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.transition_sales_commission_adjustment(uuid,text,text) to authenticated;

commit;
