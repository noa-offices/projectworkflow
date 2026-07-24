create or replace function public.validate_sales_commission_tiers(p_tiers jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  tier jsonb;
  tier_index integer;
  tier_count integer;
  tier_minimum numeric;
  tier_maximum numeric;
  tier_rate numeric;
  expected_minimum numeric := 0;
  open_ended_count integer := 0;
begin
  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) = 0 then
    return 'Add at least one commission tier.';
  end if;

  tier_count := jsonb_array_length(p_tiers);

  for tier_index in 0..tier_count - 1 loop
    tier := p_tiers -> tier_index;

    if
      jsonb_typeof(tier) <> 'object'
      or nullif(btrim(tier ->> 'minimum'), '') is null
      or nullif(btrim(tier ->> 'rate'), '') is null
    then
      return format('Tier %s is incomplete.', tier_index + 1);
    end if;

    begin
      tier_minimum := (tier ->> 'minimum')::numeric;
      tier_rate := (tier ->> 'rate')::numeric;
      tier_maximum := case
        when nullif(btrim(tier ->> 'maximum'), '') is null then null
        else (tier ->> 'maximum')::numeric
      end;
    exception when others then
      return format('Tier %s contains an invalid number.', tier_index + 1);
    end;

    if tier_minimum < 0 or tier_rate < 0 then
      return format('Tier %s cannot contain negative values.', tier_index + 1);
    end if;

    if tier_rate > 100 then
      return format('Tier %s rate cannot exceed 100 percent.', tier_index + 1);
    end if;

    if tier_minimum <> expected_minimum then
      return format('Tier %s must start at %s.', tier_index + 1, expected_minimum);
    end if;

    if tier_maximum is null then
      open_ended_count := open_ended_count + 1;
      if tier_index <> tier_count - 1 then
        return 'Only the final tier can be open-ended.';
      end if;
    elsif tier_maximum <= tier_minimum then
      return format('Tier %s maximum must be greater than its minimum.', tier_index + 1);
    else
      expected_minimum := tier_maximum;
    end if;
  end loop;

  if open_ended_count <> 1 then
    return 'The final tier must be the single open-ended tier.';
  end if;

  return null;
end;
$$;

create table public.sales_commission_rules (
  id uuid primary key default gen_random_uuid(),
  salesperson_id uuid not null references public.profiles(id) on delete restrict,
  formula_type text not null,
  basis_type text,
  percentage_rate numeric(9,4),
  fixed_amount numeric(14,2),
  fixed_amount_currency text,
  tier_configuration jsonb,
  tier_method text,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_enabled boolean not null default true,
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_commission_rules_formula_type_check
    check (formula_type in (
      'percentage',
      'fixed_amount',
      'tiered_percentage',
      'percentage_plus_fixed',
      'none'
    )),
  constraint sales_commission_rules_basis_type_check
    check (
      basis_type is null
      or basis_type in (
        'approved_total_including_vat',
        'approved_total_excluding_vat'
      )
    ),
  constraint sales_commission_rules_rate_check
    check (percentage_rate is null or percentage_rate between 0 and 100),
  constraint sales_commission_rules_fixed_amount_check
    check (fixed_amount is null or fixed_amount >= 0),
  constraint sales_commission_rules_effective_period_check
    check (effective_to is null or effective_to > effective_from),
  constraint sales_commission_rules_formula_fields_check
    check (
      (
        formula_type = 'percentage'
        and basis_type is not null
        and percentage_rate is not null
        and fixed_amount is null
        and fixed_amount_currency is null
        and tier_configuration is null
        and tier_method is null
      )
      or (
        formula_type = 'fixed_amount'
        and basis_type is null
        and percentage_rate is null
        and fixed_amount is not null
        and nullif(btrim(fixed_amount_currency), '') is not null
        and tier_configuration is null
        and tier_method is null
      )
      or (
        formula_type = 'tiered_percentage'
        and basis_type is not null
        and percentage_rate is null
        and fixed_amount is null
        and fixed_amount_currency is null
        and tier_configuration is not null
        and tier_method = 'slab'
      )
      or (
        formula_type = 'percentage_plus_fixed'
        and basis_type is not null
        and percentage_rate is not null
        and fixed_amount is not null
        and nullif(btrim(fixed_amount_currency), '') is not null
        and tier_configuration is null
        and tier_method is null
      )
      or (
        formula_type = 'none'
        and basis_type is null
        and percentage_rate is null
        and fixed_amount is null
        and fixed_amount_currency is null
        and tier_configuration is null
        and tier_method is null
      )
    )
);

create index sales_commission_rules_salesperson_period_idx
on public.sales_commission_rules (salesperson_id, effective_from, effective_to);

create or replace function public.guard_sales_commission_rule()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  tier_error text;
begin
  if new.formula_type = 'tiered_percentage' then
    tier_error := public.validate_sales_commission_tiers(new.tier_configuration);
    if tier_error is not null then
      raise exception '%', tier_error;
    end if;
  end if;

  if exists (
    select 1
    from public.sales_commission_rules existing
    where existing.salesperson_id = new.salesperson_id
      and existing.id <> new.id
      and tstzrange(existing.effective_from, existing.effective_to, '[)')
        && tstzrange(new.effective_from, new.effective_to, '[)')
  ) then
    raise exception 'Commission rule periods cannot overlap for the same Sales Manager.';
  end if;

  if tg_op = 'UPDATE'
    and coalesce(current_setting('app.commission_rule_versioning', true), '') <> 'on'
  then
    raise exception 'Historical commission rules cannot be edited directly.';
  end if;

  return new;
end;
$$;

create trigger sales_commission_rules_guard
before insert or update on public.sales_commission_rules
for each row
execute function public.guard_sales_commission_rule();

create trigger sales_commission_rules_set_updated_at
before update on public.sales_commission_rules
for each row
execute function public.set_updated_at();

create table public.sales_commissions (
  id uuid primary key default gen_random_uuid(),
  approval_snapshot_id uuid not null references public.sales_approval_snapshots(id) on delete restrict,
  quotation_id uuid not null references public.quotations(id) on delete restrict,
  quotation_folder_key text not null,
  salesperson_id uuid not null references public.profiles(id) on delete restrict,
  rule_id uuid references public.sales_commission_rules(id) on delete restrict,
  source_type text not null,
  formula_type_snapshot text,
  basis_type_snapshot text,
  formula_configuration_snapshot jsonb not null default '{}'::jsonb,
  percentage_rate_snapshot numeric(9,4),
  fixed_amount_snapshot numeric(14,2),
  fixed_amount_currency_snapshot text,
  tier_configuration_snapshot jsonb,
  tier_method_snapshot text,
  matched_tier_snapshot jsonb,
  approved_total_including_vat numeric(14,2) not null,
  vat_amount numeric(14,2),
  approved_total_excluding_vat numeric(14,2),
  commissionable_base numeric(14,2),
  commissionable_base_override numeric(14,2),
  percentage_rate_override numeric(9,4),
  fixed_amount_override numeric(14,2),
  final_amount_override numeric(14,2),
  percentage_component numeric(14,2) not null default 0,
  fixed_component numeric(14,2) not null default 0,
  original_calculated_amount numeric(14,2) not null default 0,
  final_commission_amount numeric(14,2) not null default 0,
  currency text not null,
  earned_at timestamptz not null,
  status text not null,
  review_reason text,
  override_reason text,
  overridden_by uuid references public.profiles(id) on delete restrict,
  overridden_at timestamptz,
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
  management_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_commissions_snapshot_unique unique (approval_snapshot_id),
  constraint sales_commissions_status_check
    check (status in (
      'draft',
      'requires_review',
      'pending_approval',
      'approved',
      'paid',
      'cancelled',
      'reversed'
    )),
  constraint sales_commissions_formula_type_check
    check (
      formula_type_snapshot is null
      or formula_type_snapshot in (
        'percentage',
        'fixed_amount',
        'tiered_percentage',
        'percentage_plus_fixed',
        'none'
      )
    ),
  constraint sales_commissions_basis_type_check
    check (
      basis_type_snapshot is null
      or basis_type_snapshot in (
        'approved_total_including_vat',
        'approved_total_excluding_vat'
      )
    ),
  constraint sales_commissions_amounts_check
    check (
      approved_total_including_vat >= 0
      and (vat_amount is null or vat_amount >= 0)
      and (approved_total_excluding_vat is null or approved_total_excluding_vat >= 0)
      and (commissionable_base is null or commissionable_base >= 0)
      and (commissionable_base_override is null or commissionable_base_override >= 0)
      and (percentage_rate_override is null or percentage_rate_override between 0 and 100)
      and (fixed_amount_override is null or fixed_amount_override >= 0)
      and (final_amount_override is null or final_amount_override >= 0)
      and original_calculated_amount >= 0
      and final_commission_amount >= 0
    )
);

create index sales_commissions_salesperson_earned_idx
on public.sales_commissions (salesperson_id, earned_at desc);

create index sales_commissions_status_earned_idx
on public.sales_commissions (status, earned_at desc);

create trigger sales_commissions_set_updated_at
before update on public.sales_commissions
for each row
execute function public.set_updated_at();

alter table public.sales_commission_rules enable row level security;
alter table public.sales_commissions enable row level security;

create policy sales_commission_rules_select_management
on public.sales_commission_rules
for select
to authenticated
using (
  public.current_user_is_active()
  and public.current_user_role() in ('system_owner', 'admin_manager')
);

create policy sales_commissions_select_management
on public.sales_commissions
for select
to authenticated
using (
  public.current_user_is_active()
  and public.current_user_role() in ('system_owner', 'admin_manager')
);

create policy sales_commissions_select_own
on public.sales_commissions
for select
to authenticated
using (
  public.current_user_is_active()
  and public.current_user_role() = 'sales_designer'
  and salesperson_id = auth.uid()
);

revoke all on public.sales_commission_rules from anon, authenticated;
revoke all on public.sales_commissions from anon, authenticated;
grant select on public.sales_commission_rules to authenticated;
grant select on public.sales_commissions to authenticated;
grant all on public.sales_commission_rules to service_role;
grant all on public.sales_commissions to service_role;

create or replace function public.calculate_sales_commission_values(
  p_formula_type text,
  p_basis_amount numeric,
  p_currency text,
  p_percentage_rate numeric,
  p_fixed_amount numeric,
  p_fixed_amount_currency text,
  p_tier_configuration jsonb,
  p_tier_method text
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  matched_tier jsonb;
  matched_rate numeric;
  percentage_component numeric(14,2) := 0;
  fixed_component numeric(14,2) := 0;
  calculation_error text;
begin
  if p_formula_type = 'none' then
    return jsonb_build_object(
      'commissionable_base', null,
      'percentage_component', 0,
      'fixed_component', 0,
      'original_calculated_amount', 0,
      'matched_tier', null,
      'error', null
    );
  end if;

  if p_formula_type <> 'fixed_amount' and p_basis_amount is null then
    calculation_error := 'The selected immutable commission basis is unavailable.';
  elsif p_formula_type in ('percentage', 'percentage_plus_fixed')
    and (p_percentage_rate is null or p_percentage_rate < 0 or p_percentage_rate > 100)
  then
    calculation_error := 'The percentage rate is invalid.';
  elsif p_formula_type in ('fixed_amount', 'percentage_plus_fixed')
    and (p_fixed_amount is null or p_fixed_amount < 0)
  then
    calculation_error := 'The fixed amount is invalid.';
  elsif p_formula_type in ('fixed_amount', 'percentage_plus_fixed')
    and upper(btrim(coalesce(p_fixed_amount_currency, ''))) <> upper(btrim(coalesce(p_currency, '')))
  then
    calculation_error := 'Fixed amount currency does not match the approval currency.';
  elsif p_formula_type = 'tiered_percentage' then
    calculation_error := public.validate_sales_commission_tiers(p_tier_configuration);
    if calculation_error is null and p_tier_method <> 'slab' then
      calculation_error := 'Tier method must be slab.';
    end if;

    if calculation_error is null then
      select tier
      into matched_tier
      from jsonb_array_elements(p_tier_configuration) tier
      where p_basis_amount >= (tier ->> 'minimum')::numeric
        and (
          nullif(btrim(tier ->> 'maximum'), '') is null
          or p_basis_amount < (tier ->> 'maximum')::numeric
        )
      limit 1;

      if matched_tier is null then
        calculation_error := 'No tier matches the commission basis.';
      else
        matched_rate := coalesce(p_percentage_rate, (matched_tier ->> 'rate')::numeric);
        if matched_rate < 0 or matched_rate > 100 then
          calculation_error := 'The percentage rate is invalid.';
        end if;
      end if;
    end if;
  end if;

  if calculation_error is null then
    if p_formula_type in ('percentage', 'percentage_plus_fixed') then
      percentage_component := round(p_basis_amount * p_percentage_rate / 100, 2);
    elsif p_formula_type = 'tiered_percentage' then
      percentage_component := round(p_basis_amount * matched_rate / 100, 2);
    end if;

    if p_formula_type in ('fixed_amount', 'percentage_plus_fixed') then
      fixed_component := round(p_fixed_amount, 2);
    end if;
  end if;

  return jsonb_build_object(
    'commissionable_base', p_basis_amount,
    'percentage_component', percentage_component,
    'fixed_component', fixed_component,
    'original_calculated_amount',
      case
        when calculation_error is null then percentage_component + fixed_component
        else 0
      end,
    'matched_tier', matched_tier,
    'error', calculation_error
  );
end;
$$;

create or replace function public.generate_sales_commission_for_snapshot(p_snapshot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_record public.sales_approval_snapshots%rowtype;
  rule_record public.sales_commission_rules%rowtype;
  existing_commission_id uuid;
  calculation jsonb;
  commission_id uuid;
  commission_basis numeric(14,2);
  commission_status text := 'draft';
  review_reason text;
begin
  select *
  into snapshot_record
  from public.sales_approval_snapshots
  where id = p_snapshot_id
  for update;

  if not found then
    raise exception 'Approval snapshot was not found.';
  end if;

  select id
  into existing_commission_id
  from public.sales_commissions
  where approval_snapshot_id = snapshot_record.id;

  if existing_commission_id is not null then
    return existing_commission_id;
  end if;

  select *
  into rule_record
  from public.sales_commission_rules
  where salesperson_id = snapshot_record.approved_salesperson_id
    and is_enabled = true
    and effective_from <= snapshot_record.qualified_at
    and (effective_to is null or snapshot_record.qualified_at < effective_to)
  order by effective_from desc
  limit 1;

  if rule_record.id is null then
    commission_status := 'requires_review';
    review_reason := 'No effective commission rule exists for the qualification date.';
  elsif snapshot_record.vat_amount is null then
    commission_status := 'requires_review';
    review_reason := 'Legacy approval snapshot requires ownership and VAT verification.';
  else
    commission_basis := case rule_record.basis_type
      when 'approved_total_including_vat' then snapshot_record.source_total
      when 'approved_total_excluding_vat' then snapshot_record.amount_excluding_vat
      else null
    end;

    calculation := public.calculate_sales_commission_values(
      rule_record.formula_type,
      commission_basis,
      snapshot_record.currency,
      rule_record.percentage_rate,
      rule_record.fixed_amount,
      rule_record.fixed_amount_currency,
      rule_record.tier_configuration,
      rule_record.tier_method
    );

    review_reason := nullif(calculation ->> 'error', '');
    if review_reason is not null then
      commission_status := 'requires_review';
    end if;
  end if;

  insert into public.sales_commissions (
    approval_snapshot_id,
    quotation_id,
    quotation_folder_key,
    salesperson_id,
    rule_id,
    source_type,
    formula_type_snapshot,
    basis_type_snapshot,
    formula_configuration_snapshot,
    percentage_rate_snapshot,
    fixed_amount_snapshot,
    fixed_amount_currency_snapshot,
    tier_configuration_snapshot,
    tier_method_snapshot,
    matched_tier_snapshot,
    approved_total_including_vat,
    vat_amount,
    approved_total_excluding_vat,
    commissionable_base,
    percentage_component,
    fixed_component,
    original_calculated_amount,
    final_commission_amount,
    currency,
    earned_at,
    status,
    review_reason
  )
  values (
    snapshot_record.id,
    snapshot_record.quotation_id,
    snapshot_record.quotation_folder_key,
    snapshot_record.approved_salesperson_id,
    rule_record.id,
    snapshot_record.source_type,
    rule_record.formula_type,
    rule_record.basis_type,
    case
      when rule_record.id is null then '{}'::jsonb
      else jsonb_build_object(
        'formula_type', rule_record.formula_type,
        'basis_type', rule_record.basis_type,
        'percentage_rate', rule_record.percentage_rate,
        'fixed_amount', rule_record.fixed_amount,
        'fixed_amount_currency', rule_record.fixed_amount_currency,
        'tier_configuration', rule_record.tier_configuration,
        'tier_method', rule_record.tier_method
      )
    end,
    rule_record.percentage_rate,
    rule_record.fixed_amount,
    rule_record.fixed_amount_currency,
    rule_record.tier_configuration,
    rule_record.tier_method,
    calculation -> 'matched_tier',
    snapshot_record.source_total,
    snapshot_record.vat_amount,
    snapshot_record.amount_excluding_vat,
    commission_basis,
    coalesce((calculation ->> 'percentage_component')::numeric, 0),
    coalesce((calculation ->> 'fixed_component')::numeric, 0),
    coalesce((calculation ->> 'original_calculated_amount')::numeric, 0),
    coalesce((calculation ->> 'original_calculated_amount')::numeric, 0),
    snapshot_record.currency,
    snapshot_record.qualified_at,
    commission_status,
    review_reason
  )
  returning id into commission_id;

  insert into public.audit_activity_log (
    entity_type,
    entity_id,
    parent_entity_type,
    parent_entity_id,
    action,
    title,
    description,
    metadata,
    created_by
  )
  values (
    'sales_commission',
    commission_id,
    'sales_approval_snapshot',
    snapshot_record.id,
    case
      when commission_status = 'requires_review' then 'commission_requires_review'
      else 'commission_generated'
    end,
    case
      when commission_status = 'requires_review' then 'Commission requires review'
      else 'Commission generated'
    end,
    snapshot_record.quotation_folder_key,
    jsonb_build_object(
      'approvalSnapshotId', snapshot_record.id,
      'ruleId', rule_record.id,
      'status', commission_status
    ),
    snapshot_record.source_created_by
  );

  return commission_id;
end;
$$;

revoke all on function public.generate_sales_commission_for_snapshot(uuid) from public;

create or replace function public.sales_commission_snapshot_inserted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.generate_sales_commission_for_snapshot(new.id);
  return new;
end;
$$;

revoke all on function public.sales_commission_snapshot_inserted() from public;

create trigger sales_approval_snapshots_generate_commission
after insert on public.sales_approval_snapshots
for each row
execute function public.sales_commission_snapshot_inserted();

create or replace function public.replace_sales_commission_rule_version(
  p_salesperson_id uuid,
  p_formula_type text,
  p_basis_type text,
  p_percentage_rate numeric,
  p_fixed_amount numeric,
  p_fixed_amount_currency text,
  p_tier_configuration jsonb,
  p_tier_method text,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_rule public.sales_commission_rules%rowtype;
  new_rule_id uuid;
  tier_error text;
  audit_action text;
  normalized_tiers jsonb;
begin
  if
    public.current_user_role() is distinct from 'system_owner'
    or public.current_account_status() is distinct from 'active'
  then
    raise exception 'Only the System Owner can manage commission rules.';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_salesperson_id
      and role = 'sales_designer'
      and account_status = 'active'
  ) then
    raise exception 'Select an active Sales Manager.';
  end if;

  if p_effective_from is null or (p_effective_to is not null and p_effective_to <= p_effective_from) then
    raise exception 'Enter a valid exclusive effective period.';
  end if;

  if p_formula_type = 'tiered_percentage' then
    tier_error := public.validate_sales_commission_tiers(p_tier_configuration);
    if tier_error is not null then
      raise exception '%', tier_error;
    end if;

    select jsonb_agg(
      jsonb_build_object(
        'minimum', (tier.value ->> 'minimum')::numeric,
        'maximum', case
          when nullif(btrim(tier.value ->> 'maximum'), '') is null then null
          else (tier.value ->> 'maximum')::numeric
        end,
        'rate', (tier.value ->> 'rate')::numeric
      )
      order by tier.ordinality
    )
    into normalized_tiers
    from jsonb_array_elements(p_tier_configuration) with ordinality as tier(value, ordinality);
  end if;

  perform pg_advisory_xact_lock(hashtext(p_salesperson_id::text));

  select *
  into previous_rule
  from public.sales_commission_rules
  where salesperson_id = p_salesperson_id
    and effective_from < p_effective_from
    and (effective_to is null or effective_to > p_effective_from)
  order by effective_from desc
  limit 1
  for update;

  if previous_rule.id is not null then
    perform set_config('app.commission_rule_versioning', 'on', true);
    update public.sales_commission_rules
    set effective_to = p_effective_from
    where id = previous_rule.id;
  end if;

  insert into public.sales_commission_rules (
    salesperson_id,
    formula_type,
    basis_type,
    percentage_rate,
    fixed_amount,
    fixed_amount_currency,
    tier_configuration,
    tier_method,
    effective_from,
    effective_to,
    is_enabled,
    notes,
    created_by
  )
  values (
    p_salesperson_id,
    p_formula_type,
    p_basis_type,
    p_percentage_rate,
    p_fixed_amount,
    nullif(upper(btrim(p_fixed_amount_currency)), ''),
    normalized_tiers,
    p_tier_method,
    p_effective_from,
    p_effective_to,
    true,
    nullif(btrim(p_notes), ''),
    auth.uid()
  )
  returning id into new_rule_id;

  audit_action := case
    when p_formula_type = 'none' then 'commission_rule_disabled'
    when previous_rule.id is null then 'commission_rule_created'
    else 'commission_rule_version_scheduled'
  end;

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
    'sales_commission_rule',
    new_rule_id,
    audit_action,
    case
      when audit_action = 'commission_rule_created' then 'Commission rule created'
      when audit_action = 'commission_rule_disabled' then 'Commission rule disabled'
      else 'Commission rule version scheduled'
    end,
    null,
    jsonb_build_object(
      'salespersonId', p_salesperson_id,
      'effectiveFrom', p_effective_from,
      'effectiveTo', p_effective_to,
      'formulaType', p_formula_type,
      'previousRuleId', previous_rule.id
    ),
    auth.uid()
  );

  return new_rule_id;
end;
$$;

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
  calculation_error text;
  has_override boolean;
  override_changed boolean;
begin
  if
    public.current_user_role() is distinct from 'system_owner'
    or public.current_account_status() is distinct from 'active'
  then
    raise exception 'Only the System Owner can edit commission calculations.';
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
  has_override :=
    p_base_override is not null
    or p_percentage_rate_override is not null
    or p_fixed_amount_override is not null
    or p_final_amount_override is not null;
  override_changed :=
    p_base_override is distinct from commission_record.commissionable_base_override
    or p_percentage_rate_override is distinct from commission_record.percentage_rate_override
    or p_fixed_amount_override is distinct from commission_record.fixed_amount_override
    or p_final_amount_override is distinct from commission_record.final_amount_override;

  if (has_override or override_changed) and nullif(btrim(p_override_reason), '') is null then
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
    final_amount_override = p_final_amount_override,
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
    override_reason = case when has_override then nullif(btrim(p_override_reason), '') else null end,
    overridden_by = case when has_override or override_changed then auth.uid() else null end,
    overridden_at = case when has_override or override_changed then now() else null end,
    management_notes = nullif(btrim(p_management_notes), '')
  where id = commission_record.id;

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
    case when has_override or override_changed then 'commission_overridden' else 'commission_recalculated' end,
    case when has_override or override_changed then 'Commission overridden' else 'Commission recalculated' end,
    case when has_override or override_changed then nullif(btrim(p_override_reason), '') else null end,
    jsonb_build_object(
      'ruleId', rule_record.id,
      'status', case when calculation_error is null then 'draft' else 'requires_review' end
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
begin
  if
    public.current_user_role() is distinct from 'system_owner'
    or public.current_account_status() is distinct from 'active'
  then
    raise exception 'Only the System Owner can change commission workflow status.';
  end if;

  select *
  into commission_record
  from public.sales_commissions
  where id = p_commission_id
  for update;

  if commission_record.id is null then
    raise exception 'Commission record was not found.';
  end if;

  if not (
    (commission_record.status = 'draft' and p_target_status in ('pending_approval', 'cancelled'))
    or (commission_record.status = 'pending_approval' and p_target_status in ('draft', 'approved', 'cancelled'))
    or (commission_record.status = 'approved' and p_target_status in ('paid', 'reversed'))
    or (commission_record.status = 'paid' and p_target_status = 'reversed')
  ) then
    raise exception 'That commission status transition is not allowed.';
  end if;

  if p_target_status in ('draft', 'cancelled', 'reversed')
    and nullif(btrim(p_reason), '') is null
  then
    raise exception 'A reason is required for this status change.';
  end if;

  if p_target_status = 'pending_approval' and commission_record.review_reason is not null then
    raise exception 'Resolve the review issue before submitting this commission.';
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

  select action, title
  into audit_action, audit_title
  from (
    values
      ('pending_approval', 'commission_submitted', 'Commission submitted'),
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
      'toStatus', p_target_status
    ),
    auth.uid()
  );

  return commission_record.id;
end;
$$;

create or replace function public.list_commission_sales_managers()
returns table (
  id uuid,
  display_name text,
  account_status public.account_status
)
language sql
stable
security definer
set search_path = public
as $$
  select
    profiles.id,
    coalesce(nullif(btrim(profiles.full_name), ''), profiles.email, profiles.id::text),
    profiles.account_status
  from public.profiles
  where profiles.role = 'sales_designer'
    and public.current_user_is_active()
    and public.current_user_role() in ('system_owner', 'admin_manager')
  order by coalesce(nullif(btrim(profiles.full_name), ''), profiles.email, profiles.id::text);
$$;

revoke all on function public.replace_sales_commission_rule_version(
  uuid, text, text, numeric, numeric, text, jsonb, text, timestamptz, timestamptz, text
) from public, anon;
revoke all on function public.recalculate_sales_commission(
  uuid, uuid, numeric, numeric, numeric, numeric, text, text
) from public, anon;
revoke all on function public.transition_sales_commission(uuid, text, text) from public, anon;
revoke all on function public.list_commission_sales_managers() from public, anon;

grant execute on function public.replace_sales_commission_rule_version(
  uuid, text, text, numeric, numeric, text, jsonb, text, timestamptz, timestamptz, text
) to authenticated;
grant execute on function public.recalculate_sales_commission(
  uuid, uuid, numeric, numeric, numeric, numeric, text, text
) to authenticated;
grant execute on function public.transition_sales_commission(uuid, text, text) to authenticated;
grant execute on function public.list_commission_sales_managers() to authenticated;

do $$
declare
  snapshot_record record;
begin
  for snapshot_record in
    select id from public.sales_approval_snapshots
  loop
    perform public.generate_sales_commission_for_snapshot(snapshot_record.id);
  end loop;
end;
$$;
