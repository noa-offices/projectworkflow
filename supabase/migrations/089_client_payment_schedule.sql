create or replace function public.current_user_can_view_client_payments()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_user_role() in ('system_owner', 'admin_manager')
    and public.current_account_status() = 'active',
    false
  );
$$;

create or replace function public.current_user_can_manage_client_payment_installments()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_can_view_client_payments();
$$;

create or replace function public.current_user_can_record_client_payment_receipts()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_can_view_client_payments();
$$;

create or replace function public.current_user_can_void_client_payment_receipts()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_user_role() = 'system_owner'
    and public.current_account_status() = 'active',
    false
  );
$$;

grant execute on function public.current_user_can_view_client_payments() to authenticated;
grant execute on function public.current_user_can_manage_client_payment_installments() to authenticated;
grant execute on function public.current_user_can_record_client_payment_receipts() to authenticated;
grant execute on function public.current_user_can_void_client_payment_receipts() to authenticated;

create table public.client_payment_schedules (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete restrict,
  order_no text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_payment_schedules_quotation_unique unique (quotation_id),
  constraint client_payment_schedules_order_no_unique unique (order_no)
);

create table public.client_payment_installments (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.client_payment_schedules(id) on delete restrict,
  sequence_no integer not null check (sequence_no > 0),
  title text not null check (length(btrim(title)) > 0),
  calculation_type text not null check (calculation_type in ('percentage', 'fixed')),
  percentage numeric(7,4),
  expected_amount numeric(14,2) not null check (expected_amount >= 0),
  due_type text not null check (due_type in (
    'fixed_date',
    'project_confirmation',
    'before_order',
    'before_delivery',
    'on_delivery',
    'before_installation',
    'after_installation',
    'handover',
    'custom'
  )),
  due_date date,
  custom_due_description text,
  due_triggered_at timestamptz,
  status_override text check (status_override is null or status_override in ('waived', 'cancelled')),
  note text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_payment_installments_sequence_unique unique (schedule_id, sequence_no) deferrable initially immediate,
  constraint client_payment_installments_calculation_check check (
    (calculation_type = 'percentage' and percentage > 0 and percentage <= 100)
    or (calculation_type = 'fixed' and percentage is null)
  ),
  constraint client_payment_installments_due_check check (
    (due_type = 'fixed_date' and due_date is not null)
    or (due_type = 'custom' and length(btrim(custom_due_description)) > 0)
    or (due_type not in ('fixed_date', 'custom'))
  )
);

create table public.client_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.client_payment_schedules(id) on delete restrict,
  installment_id uuid references public.client_payment_installments(id) on delete restrict,
  amount_received numeric(14,2) not null check (amount_received > 0),
  received_on date not null,
  payment_method text not null check (payment_method in (
    'bank_transfer', 'cheque', 'cash', 'card', 'online_payment', 'other'
  )),
  reference_number text,
  bank_account_note text,
  comment text,
  idempotency_key uuid not null unique,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text,
  constraint client_payment_receipts_void_check check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(btrim(void_reason)) > 0)
  )
);

create table public.client_payment_receipt_attachments (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.client_payment_receipts(id) on delete restrict,
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index client_payment_installments_schedule_sequence_idx
  on public.client_payment_installments (schedule_id, sequence_no);
create index client_payment_installments_schedule_due_idx
  on public.client_payment_installments (schedule_id, due_date)
  where status_override is null;
create index client_payment_receipts_installment_received_idx
  on public.client_payment_receipts (installment_id, received_on, created_at);
create index client_payment_receipts_schedule_received_idx
  on public.client_payment_receipts (schedule_id, received_on);
create index client_payment_receipts_active_installment_idx
  on public.client_payment_receipts (installment_id)
  where voided_at is null;
create index client_payment_receipts_schedule_reference_idx
  on public.client_payment_receipts (schedule_id, reference_number)
  where reference_number is not null;
create index client_payment_receipt_attachments_receipt_idx
  on public.client_payment_receipt_attachments (receipt_id);

alter table public.client_payment_schedules enable row level security;
alter table public.client_payment_installments enable row level security;
alter table public.client_payment_receipts enable row level security;
alter table public.client_payment_receipt_attachments enable row level security;

create policy client_payment_schedules_select
  on public.client_payment_schedules for select to authenticated
  using (public.current_user_can_view_client_payments());
create policy client_payment_installments_select
  on public.client_payment_installments for select to authenticated
  using (public.current_user_can_view_client_payments());
create policy client_payment_receipts_select
  on public.client_payment_receipts for select to authenticated
  using (public.current_user_can_view_client_payments());
create policy client_payment_receipt_attachments_select
  on public.client_payment_receipt_attachments for select to authenticated
  using (public.current_user_can_view_client_payments());

revoke all on public.client_payment_schedules from anon, authenticated;
revoke all on public.client_payment_installments from anon, authenticated;
revoke all on public.client_payment_receipts from anon, authenticated;
revoke all on public.client_payment_receipt_attachments from anon, authenticated;
grant select on public.client_payment_schedules to authenticated;
grant select on public.client_payment_installments to authenticated;
grant select on public.client_payment_receipts to authenticated;
grant select on public.client_payment_receipt_attachments to authenticated;

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
  v_order_no text;
  v_total_text text;
  v_total numeric(14,2);
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

  v_order_no := coalesce(
    v_quotation.layout_settings #>> '{projectFile,orderNo}',
    v_quotation.layout_settings #>> '{clientApprovalDraft,confirmedOrder,orderNo}',
    v_quotation.layout_settings #>> '{clientApproval,confirmedOrder,orderNo}'
  );
  v_total_text := coalesce(
    v_quotation.layout_settings #>> '{projectFile,total}',
    v_quotation.layout_settings #>> '{clientApprovalDraft,confirmedOrder,total}',
    v_quotation.layout_settings #>> '{clientApproval,confirmedOrder,total}'
  );

  if v_order_no is null or v_order_no <> btrim(p_order_no) then
    raise exception 'Project File does not belong to this quotation.';
  end if;
  if v_total_text is null or v_total_text !~ '^-?[0-9]+([.][0-9]+)?$' then
    raise exception 'Project File contract total is invalid.';
  end if;

  v_total := round(v_total_text::numeric, 2);
  if p_contract_total is null
    or v_total < 0
    or round(coalesce(v_quotation.grand_total, 0), 2) <> v_total
    or round(p_contract_total, 2) <> v_total then
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
    v_expected := round(v_context.contract_total * p_percentage / 100, 2);
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
    v_expected := round(v_context.contract_total * p_percentage / 100, 2);
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

create or replace function public.delete_client_payment_installment(
  p_installment_id uuid,
  p_quotation_id uuid,
  p_order_no text,
  p_contract_total numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_schedule_id uuid;
begin
  if not public.current_user_can_manage_client_payment_installments() then raise exception 'Forbidden.'; end if;
  select * into v_context from public.client_payment_project_context(p_quotation_id, p_order_no, p_contract_total);
  if v_context.is_completed or v_context.is_cancelled then raise exception 'Completed or cancelled Project File instalments are read-only.'; end if;
  select i.schedule_id into v_schedule_id
  from public.client_payment_installments i join public.client_payment_schedules s on s.id = i.schedule_id
  where i.id = p_installment_id and s.quotation_id = p_quotation_id and s.order_no = btrim(p_order_no)
  for update;
  if not found then raise exception 'Instalment not found.'; end if;
  if exists (select 1 from public.client_payment_receipts where installment_id = p_installment_id) then
    raise exception 'Instalments with receipt history cannot be deleted.';
  end if;
  delete from public.client_payment_installments where id = p_installment_id;
  set constraints client_payment_installments_sequence_unique deferred;
  with ordered as (
    select id, row_number() over (order by sequence_no, created_at, id)::integer as next_sequence
    from public.client_payment_installments where schedule_id = v_schedule_id
  )
  update public.client_payment_installments i set sequence_no = ordered.next_sequence
  from ordered where i.id = ordered.id;
end;
$$;

create or replace function public.move_client_payment_installment(
  p_installment_id uuid,
  p_quotation_id uuid,
  p_order_no text,
  p_contract_total numeric,
  p_direction integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_current public.client_payment_installments%rowtype;
  v_target public.client_payment_installments%rowtype;
begin
  if not public.current_user_can_manage_client_payment_installments() then raise exception 'Forbidden.'; end if;
  if p_direction not in (-1, 1) then raise exception 'Direction must be -1 or 1.'; end if;
  select * into v_context from public.client_payment_project_context(p_quotation_id, p_order_no, p_contract_total);
  if v_context.is_completed or v_context.is_cancelled then raise exception 'Completed or cancelled Project File instalments are read-only.'; end if;
  select i.* into v_current
  from public.client_payment_installments i join public.client_payment_schedules s on s.id = i.schedule_id
  where i.id = p_installment_id and s.quotation_id = p_quotation_id and s.order_no = btrim(p_order_no)
  for update;
  if not found then raise exception 'Instalment not found.'; end if;
  select * into v_target from public.client_payment_installments
  where schedule_id = v_current.schedule_id and sequence_no = v_current.sequence_no + p_direction
  for update;
  if not found then return; end if;
  set constraints client_payment_installments_sequence_unique deferred;
  update public.client_payment_installments set sequence_no = v_target.sequence_no, updated_by = auth.uid(), updated_at = now() where id = v_current.id;
  update public.client_payment_installments set sequence_no = v_current.sequence_no, updated_by = auth.uid(), updated_at = now() where id = v_target.id;
end;
$$;

revoke all on function public.add_client_payment_installment(uuid, text, numeric, text, text, numeric, numeric, text, date, text, text, text) from public, anon;
revoke all on function public.update_client_payment_installment(uuid, uuid, text, numeric, text, text, numeric, numeric, text, date, text, text, text) from public, anon;
revoke all on function public.delete_client_payment_installment(uuid, uuid, text, numeric) from public, anon;
revoke all on function public.move_client_payment_installment(uuid, uuid, text, numeric, integer) from public, anon;
grant execute on function public.add_client_payment_installment(uuid, text, numeric, text, text, numeric, numeric, text, date, text, text, text) to authenticated;
grant execute on function public.update_client_payment_installment(uuid, uuid, text, numeric, text, text, numeric, numeric, text, date, text, text, text) to authenticated;
grant execute on function public.delete_client_payment_installment(uuid, uuid, text, numeric) to authenticated;
grant execute on function public.move_client_payment_installment(uuid, uuid, text, numeric, integer) to authenticated;
