-- APPLY: Step C2b, the client payment schedule follows an applied Project variation. Run client_payment_variation_instalments_TEST.sql first.
-- The project_variations migration (20261108100000) and the payment migrations 089 to 093 must already be applied. The same text as migrations/20261109100000_client_payment_variation_instalments.sql.
begin;

-- Step C2b: the client payment schedule follows an applied Project variation (decision: EXTRA INSTALMENT).
-- Apply after 20261108100000_project_variations.sql (this migration references project_variations).
--
-- Existing instalments keep their amounts, and money received never changes. Each applied variation gets ONE extra fixed instalment, "Variation V<n>", created by a
-- user (add_client_payment_variation_instalment). A Project without an applied variation behaves exactly as before.
--
-- 1. client_payment_project_context: same signature, errors and security. For a Project with an applied variation it returns the REVISED total (the latest
--    applied variation's new_contract_total), so the "contract total has changed" check, the scheduled-total cap and the receipt/attachment checks all use it.
-- 2. client_payment_project_original_total (new, private): the Project File's ORIGINAL total, used only as the base for percentage instalments, so a note-only
--    edit of an existing 30% instalment never changes its amount. With no variation it returns exactly what the context returns.
-- 3. add_client_payment_installment / update_client_payment_installment: only the percentage base changes. The cap still uses the context total.
-- 4. client_payment_installments.variation_id (unique): at most one instalment per variation.

alter table public.client_payment_installments
  add column if not exists variation_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_payment_installments_variation_unique' and conrelid = 'public.client_payment_installments'::regclass) then
    alter table public.client_payment_installments
      add constraint client_payment_installments_variation_unique unique (variation_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_payment_installments_variation_fkey' and conrelid = 'public.client_payment_installments'::regclass) then
    alter table public.client_payment_installments
      add constraint client_payment_installments_variation_fkey foreign key (variation_id) references public.project_variations(id) on delete restrict;
  end if;
end $$;

create or replace function public.client_payment_project_context(
  p_quotation_id uuid,
  p_order_no text,
  p_contract_total numeric
)
returns table (contract_total numeric, is_completed boolean, is_cancelled boolean, currency text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation public.quotations%rowtype;
  v_project_file jsonb;
  v_order_no text;
  v_project_quotation_id text;
  v_total_text text;
  v_total numeric(14,2);
  v_expected_total numeric(14,2);
  v_revised_total numeric;
begin
  select * into v_quotation
  from public.quotations
  where id = p_quotation_id
    and status = 'client_confirmed'
    and is_active = true
  for update;

  if not found then
    raise exception 'Confirmed quotation not found.';
  end if;

  if jsonb_typeof(v_quotation.layout_settings -> 'projectFile') = 'object' then
    v_project_file := v_quotation.layout_settings -> 'projectFile';
  elsif jsonb_typeof(v_quotation.layout_settings #> '{clientApprovalDraft,confirmedOrder}') = 'object' then
    v_project_file := v_quotation.layout_settings #> '{clientApprovalDraft,confirmedOrder}';
  elsif jsonb_typeof(v_quotation.layout_settings #> '{clientApproval,confirmedOrder}') = 'object' then
    v_project_file := v_quotation.layout_settings #> '{clientApproval,confirmedOrder}';
  else
    raise exception 'Project File does not belong to this quotation.';
  end if;

  v_order_no := v_project_file ->> 'orderNo';
  v_project_quotation_id := v_project_file ->> 'quotationId';
  v_total_text := v_project_file ->> 'total';

  if v_order_no is null or v_order_no <> btrim(p_order_no) then
    raise exception 'Project File does not belong to this quotation.';
  end if;
  if v_project_quotation_id is null or v_project_quotation_id <> p_quotation_id::text then
    raise exception 'Project File does not belong to this quotation.';
  end if;
  if v_total_text is null or v_total_text !~ '^-?[0-9]+([.][0-9]+)?$' then
    raise exception 'Project File contract total is invalid.';
  end if;

  -- The Project File snapshot is the contract value. quotations.grand_total can
  -- be the pre-policy amount before Project File creation rounds to AED 5.
  v_total := round(v_total_text::numeric, 2)::numeric(14,2);
  -- A Project with an applied variation is paid against its revised contract total: the latest applied variation's new_contract_total.
  select v.new_contract_total into v_revised_total
  from public.project_variations v
  join public.project_snapshots s on s.id = v.snapshot_id
  where s.quotation_id = p_quotation_id
  order by v.variation_no desc
  limit 1;
  if v_revised_total is not null then
    v_total := round(v_revised_total, 2)::numeric(14,2);
  end if;
  v_expected_total := round(p_contract_total, 2)::numeric(14,2);
  if p_contract_total is null
    or v_total < 0
    or v_expected_total <> v_total then
    raise exception 'Project File contract total has changed. Reload before continuing.';
  end if;

  return query select
    v_total,
    (v_quotation.layout_settings ->> 'projectCompletedAt') is not null,
    (v_quotation.layout_settings ->> 'projectCancelledAt') is not null,
    coalesce(nullif(btrim(v_quotation.currency), ''), 'AED');
end;
$$;

revoke all on function public.client_payment_project_context(uuid, text, numeric) from public, anon, authenticated;

create or replace function public.client_payment_project_original_total(
  p_quotation_id uuid,
  p_order_no text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_quotation public.quotations%rowtype;
  v_project_file jsonb;
  v_total_text text;
  v_total numeric(14,2);
begin
  select * into v_quotation
  from public.quotations
  where id = p_quotation_id
    and status = 'client_confirmed'
    and is_active = true;

  if not found then
    raise exception 'Confirmed quotation not found.';
  end if;

  if jsonb_typeof(v_quotation.layout_settings -> 'projectFile') = 'object' then
    v_project_file := v_quotation.layout_settings -> 'projectFile';
  elsif jsonb_typeof(v_quotation.layout_settings #> '{clientApprovalDraft,confirmedOrder}') = 'object' then
    v_project_file := v_quotation.layout_settings #> '{clientApprovalDraft,confirmedOrder}';
  elsif jsonb_typeof(v_quotation.layout_settings #> '{clientApproval,confirmedOrder}') = 'object' then
    v_project_file := v_quotation.layout_settings #> '{clientApproval,confirmedOrder}';
  else
    raise exception 'Project File does not belong to this quotation.';
  end if;

  if (v_project_file ->> 'orderNo') is null or (v_project_file ->> 'orderNo') <> btrim(p_order_no)
    or (v_project_file ->> 'quotationId') is null or (v_project_file ->> 'quotationId') <> p_quotation_id::text then
    raise exception 'Project File does not belong to this quotation.';
  end if;

  v_total_text := v_project_file ->> 'total';
  if v_total_text is null or v_total_text !~ '^-?[0-9]+([.][0-9]+)?$' then
    raise exception 'Project File contract total is invalid.';
  end if;
  v_total := round(v_total_text::numeric, 2)::numeric(14,2);
  if v_total < 0 then
    raise exception 'Project File contract total is invalid.';
  end if;
  return v_total;
end;
$$;

revoke all on function public.client_payment_project_original_total(uuid, text) from public, anon, authenticated;

create or replace function public.add_client_payment_installment(
  p_quotation_id uuid,
  p_order_no text,
  p_contract_total numeric,
  p_title text,
  p_calculation_type text,
  p_percentage numeric,
  p_fixed_amount numeric,
  p_due_type text,
  p_due_date date,
  p_custom_due_description text,
  p_note text,
  p_status_override text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_schedule_id uuid;
  v_expected numeric(14,2);
  v_sequence integer;
  v_scheduled numeric(14,2);
  v_id uuid;
begin
  if not public.current_user_can_manage_client_payment_installments() then
    raise exception 'Forbidden.';
  end if;
  select * into v_context from public.client_payment_project_context(p_quotation_id, p_order_no, p_contract_total);
  if v_context.is_completed or v_context.is_cancelled then
    raise exception 'Completed or cancelled Project File instalments are read-only.';
  end if;
  if nullif(btrim(p_title), '') is null then raise exception 'Title is required.'; end if;
  if p_calculation_type = 'percentage' then
    if p_percentage is null or p_percentage <= 0 or p_percentage > 100 then
      raise exception 'Percentage must be greater than 0 and no more than 100.';
    end if;
    if p_fixed_amount is not null then raise exception 'Percentage and fixed amount cannot both be supplied.'; end if;
    v_expected := round(public.client_payment_project_original_total(p_quotation_id, p_order_no) * p_percentage / 100, 2);
  elsif p_calculation_type = 'fixed' then
    if p_percentage is not null then raise exception 'Fixed instalments cannot contain a percentage.'; end if;
    if p_fixed_amount is null or p_fixed_amount < 0 then raise exception 'Expected amount cannot be negative.'; end if;
    v_expected := round(p_fixed_amount, 2);
  else
    raise exception 'Invalid calculation type.';
  end if;

  insert into public.client_payment_schedules (quotation_id, order_no, created_by)
  values (p_quotation_id, btrim(p_order_no), auth.uid())
  on conflict (quotation_id) do update set updated_at = now()
  returning id into v_schedule_id;

  if exists (select 1 from public.client_payment_schedules where order_no = btrim(p_order_no) and quotation_id <> p_quotation_id) then
    raise exception 'Project File number is already linked to another quotation.';
  end if;

  select coalesce(sum(expected_amount) filter (where status_override is distinct from 'cancelled'), 0)
    into v_scheduled
  from public.client_payment_installments
  where schedule_id = v_schedule_id;
  if p_status_override is distinct from 'cancelled' and v_scheduled + v_expected > v_context.contract_total then
    raise exception 'Scheduled total cannot exceed the Project File contract total.';
  end if;

  select coalesce(max(sequence_no), 0) + 1 into v_sequence
  from public.client_payment_installments where schedule_id = v_schedule_id;

  insert into public.client_payment_installments (
    schedule_id, sequence_no, title, calculation_type, percentage, expected_amount,
    due_type, due_date, custom_due_description, status_override, note, created_by, updated_by
  ) values (
    v_schedule_id, v_sequence, btrim(p_title), p_calculation_type,
    case when p_calculation_type = 'percentage' then p_percentage else null end,
    v_expected, p_due_type, p_due_date, nullif(btrim(p_custom_due_description), ''),
    p_status_override, nullif(btrim(p_note), ''), auth.uid(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_client_payment_installment(
  p_installment_id uuid,
  p_quotation_id uuid,
  p_order_no text,
  p_contract_total numeric,
  p_title text,
  p_calculation_type text,
  p_percentage numeric,
  p_fixed_amount numeric,
  p_due_type text,
  p_due_date date,
  p_custom_due_description text,
  p_note text,
  p_status_override text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_installment public.client_payment_installments%rowtype;
  v_expected numeric(14,2);
  v_other_scheduled numeric(14,2);
  v_received numeric(14,2);
begin
  if not public.current_user_can_manage_client_payment_installments() then raise exception 'Forbidden.'; end if;
  select * into v_context from public.client_payment_project_context(p_quotation_id, p_order_no, p_contract_total);
  if v_context.is_completed or v_context.is_cancelled then raise exception 'Completed or cancelled Project File instalments are read-only.'; end if;

  select i.* into v_installment
  from public.client_payment_installments i
  join public.client_payment_schedules s on s.id = i.schedule_id
  where i.id = p_installment_id and s.quotation_id = p_quotation_id and s.order_no = btrim(p_order_no)
  for update;
  if not found then raise exception 'Instalment not found.'; end if;
  if nullif(btrim(p_title), '') is null then raise exception 'Title is required.'; end if;

  if p_calculation_type = 'percentage' then
    if p_percentage is null or p_percentage <= 0 or p_percentage > 100 then raise exception 'Percentage must be greater than 0 and no more than 100.'; end if;
    if p_fixed_amount is not null then raise exception 'Percentage and fixed amount cannot both be supplied.'; end if;
    v_expected := round(public.client_payment_project_original_total(p_quotation_id, p_order_no) * p_percentage / 100, 2);
  elsif p_calculation_type = 'fixed' then
    if p_percentage is not null then raise exception 'Fixed instalments cannot contain a percentage.'; end if;
    if p_fixed_amount is null or p_fixed_amount < 0 then raise exception 'Expected amount cannot be negative.'; end if;
    v_expected := round(p_fixed_amount, 2);
  else raise exception 'Invalid calculation type.';
  end if;

  select coalesce(sum(amount_received) filter (where voided_at is null), 0) into v_received
  from public.client_payment_receipts where installment_id = p_installment_id;
  if v_expected < v_received then raise exception 'Expected amount cannot be lower than valid receipts.'; end if;
  if p_status_override is not null and v_received > 0 then raise exception 'An instalment with receipts cannot be waived or cancelled.'; end if;

  select coalesce(sum(expected_amount) filter (where status_override is distinct from 'cancelled'), 0)
    into v_other_scheduled
  from public.client_payment_installments
  where schedule_id = v_installment.schedule_id and id <> p_installment_id;
  if p_status_override is distinct from 'cancelled' and v_other_scheduled + v_expected > v_context.contract_total then
    raise exception 'Scheduled total cannot exceed the Project File contract total.';
  end if;

  update public.client_payment_installments set
    title = btrim(p_title), calculation_type = p_calculation_type,
    percentage = case when p_calculation_type = 'percentage' then p_percentage else null end,
    expected_amount = v_expected, due_type = p_due_type, due_date = p_due_date,
    custom_due_description = nullif(btrim(p_custom_due_description), ''),
    status_override = p_status_override, note = nullif(btrim(p_note), ''),
    updated_by = auth.uid(), updated_at = now()
  where id = p_installment_id;
end;
$$;

create or replace function public.add_client_payment_variation_instalment(
  p_quotation_id uuid,
  p_order_no text,
  p_contract_total numeric,
  p_variation_no integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_variation public.project_variations%rowtype;
  v_schedule_id uuid;
  v_expected numeric(14,2);
  v_scheduled numeric(14,2);
  v_sequence integer;
  v_id uuid;
begin
  if not public.current_user_can_manage_client_payment_installments() then
    raise exception 'Forbidden.';
  end if;
  select * into v_context from public.client_payment_project_context(p_quotation_id, p_order_no, p_contract_total);
  if v_context.is_completed or v_context.is_cancelled then
    raise exception 'Completed or cancelled Project File instalments are read-only.';
  end if;

  select v.* into v_variation
  from public.project_variations v
  join public.project_snapshots s on s.id = v.snapshot_id
  where s.quotation_id = p_quotation_id
    and v.variation_no = p_variation_no;
  if not found then
    raise exception 'Variation not found.';
  end if;
  if v_variation.contract_delta <= 0 then
    raise exception 'This variation does not increase the contract. Adjust the remaining instalments by hand.';
  end if;
  if exists (select 1 from public.client_payment_installments where variation_id = v_variation.id) then
    raise exception 'This variation already has an instalment.';
  end if;
  v_expected := round(v_variation.contract_delta, 2);

  insert into public.client_payment_schedules (quotation_id, order_no, created_by)
  values (p_quotation_id, btrim(p_order_no), auth.uid())
  on conflict (quotation_id) do update set updated_at = now()
  returning id into v_schedule_id;

  if exists (select 1 from public.client_payment_schedules where order_no = btrim(p_order_no) and quotation_id <> p_quotation_id) then
    raise exception 'Project File number is already linked to another quotation.';
  end if;

  select coalesce(sum(expected_amount) filter (where status_override is distinct from 'cancelled'), 0)
    into v_scheduled
  from public.client_payment_installments
  where schedule_id = v_schedule_id;
  if v_scheduled + v_expected > v_context.contract_total then
    raise exception 'Scheduled total cannot exceed the Project File contract total.';
  end if;

  select coalesce(max(sequence_no), 0) + 1 into v_sequence
  from public.client_payment_installments where schedule_id = v_schedule_id;

  insert into public.client_payment_installments (
    schedule_id, sequence_no, title, calculation_type, percentage, expected_amount,
    due_type, custom_due_description, variation_id, created_by, updated_by
  ) values (
    v_schedule_id, v_sequence, 'Variation V' || v_variation.variation_no, 'fixed', null, v_expected,
    'custom', 'As agreed for Variation V' || v_variation.variation_no, v_variation.id, auth.uid(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.add_client_payment_installment(uuid, text, numeric, text, text, numeric, numeric, text, date, text, text, text) from public, anon;
revoke all on function public.update_client_payment_installment(uuid, uuid, text, numeric, text, text, numeric, numeric, text, date, text, text, text) from public, anon;
revoke all on function public.add_client_payment_variation_instalment(uuid, text, numeric, integer) from public, anon;
grant execute on function public.add_client_payment_installment(uuid, text, numeric, text, text, numeric, numeric, text, date, text, text, text) to authenticated;
grant execute on function public.update_client_payment_installment(uuid, uuid, text, numeric, text, text, numeric, numeric, text, date, text, text, text) to authenticated;
grant execute on function public.add_client_payment_variation_instalment(uuid, text, numeric, integer) to authenticated;

commit;
