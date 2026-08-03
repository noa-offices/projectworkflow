-- Receipt workflow is intentionally rerunnable. Each row variable is populated by
-- one SELECT target; PostgreSQL does not allow record variables in a multi-item
-- INTO list.
create or replace function public.record_client_payment_receipt(
  p_installment_id uuid,
  p_quotation_id uuid,
  p_order_no text,
  p_contract_total numeric,
  p_amount_received numeric,
  p_received_on date,
  p_payment_method text,
  p_reference_number text,
  p_bank_account_note text,
  p_comment text,
  p_idempotency_key uuid,
  p_confirm_overpayment boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_installment public.client_payment_installments%rowtype;
  v_existing_id uuid;
  v_received numeric(14,2);
  v_remaining numeric(14,2);
  v_receipt_id uuid;
  v_amount numeric(14,2);
begin
  if not public.current_user_can_record_client_payment_receipts() then
    raise exception 'Forbidden.';
  end if;
  if p_idempotency_key is null then raise exception 'Idempotency key is required.'; end if;

  select id into v_existing_id
  from public.client_payment_receipts
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('id', v_existing_id, 'created', false);
  end if;

  select * into v_context
  from public.client_payment_project_context(p_quotation_id, p_order_no, p_contract_total);
  if v_context.is_cancelled then raise exception 'Receipts cannot be recorded for a cancelled Project File.'; end if;
  if p_amount_received is null or p_amount_received <= 0 then raise exception 'Received amount must be positive.'; end if;
  if p_received_on is null then raise exception 'Received date is required.'; end if;
  if p_payment_method not in ('bank_transfer', 'cheque', 'cash', 'card', 'online_payment', 'other') then
    raise exception 'Invalid payment method.';
  end if;
  v_amount := round(p_amount_received, 2);

  select i.* into v_installment
  from public.client_payment_installments i
  join public.client_payment_schedules s on s.id = i.schedule_id
  where i.id = p_installment_id
    and s.quotation_id = p_quotation_id
    and s.order_no = btrim(p_order_no)
  for update of i;
  if not found then raise exception 'Instalment not found.'; end if;
  if v_installment.status_override is not null then
    raise exception 'Receipts cannot be recorded against a waived or cancelled instalment.';
  end if;

  select coalesce(sum(amount_received) filter (where voided_at is null), 0)
  into v_received
  from public.client_payment_receipts
  where installment_id = p_installment_id;
  v_remaining := greatest(v_installment.expected_amount - v_received, 0);
  if v_amount > v_remaining and not coalesce(p_confirm_overpayment, false) then
    raise exception 'Receipt exceeds the remaining instalment balance. Confirm the overpayment to continue.';
  end if;

  begin
    insert into public.client_payment_receipts (
      schedule_id, installment_id, amount_received, received_on, payment_method,
      reference_number, bank_account_note, comment, idempotency_key, recorded_by
    ) values (
      v_installment.schedule_id, v_installment.id, v_amount, p_received_on, p_payment_method,
      nullif(btrim(p_reference_number), ''), nullif(btrim(p_bank_account_note), ''),
      nullif(btrim(p_comment), ''), p_idempotency_key, auth.uid()
    ) returning id into v_receipt_id;
  exception when unique_violation then
    select id into v_receipt_id from public.client_payment_receipts where idempotency_key = p_idempotency_key;
    return jsonb_build_object('id', v_receipt_id, 'created', false);
  end;

  insert into public.audit_activity_log (
    entity_type, entity_id, parent_entity_type, parent_entity_id,
    action, title, description, metadata, created_by
  ) values (
    'client_payment_receipt', v_receipt_id, 'quotation', p_quotation_id,
    'client_payment_received',
    'Client payment received - ' || v_context.currency || ' ' || trim(to_char(v_amount, 'FM999999999999990D00')),
    'Payment received for ' || v_installment.title || '.',
    jsonb_build_object(
      'orderNo', btrim(p_order_no),
      'scheduleId', v_installment.schedule_id,
      'installmentId', v_installment.id,
      'receiptId', v_receipt_id,
      'amount', v_amount,
      'currency', v_context.currency,
      'paymentTitle', v_installment.title,
      'paymentMethod', p_payment_method,
      'eventCategory', 'Payment'
    ),
    auth.uid()
  );

  return jsonb_build_object('id', v_receipt_id, 'created', true, 'overpayment', v_amount > v_remaining);
end;
$$;

create or replace function public.void_client_payment_receipt(
  p_receipt_id uuid,
  p_quotation_id uuid,
  p_order_no text,
  p_contract_total numeric,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_receipt public.client_payment_receipts%rowtype;
  v_installment public.client_payment_installments%rowtype;
begin
  if not public.current_user_can_void_client_payment_receipts() then raise exception 'Forbidden.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A void reason is required.'; end if;
  select * into v_context from public.client_payment_project_context(p_quotation_id, p_order_no, p_contract_total);

  select r.* into v_receipt
  from public.client_payment_receipts r
  join public.client_payment_schedules s on s.id = r.schedule_id
  where r.id = p_receipt_id
    and s.quotation_id = p_quotation_id
    and s.order_no = btrim(p_order_no)
  for update of r;
  if not found then raise exception 'Receipt not found.'; end if;
  if v_receipt.voided_at is not null then raise exception 'Receipt is already voided.'; end if;

  select * into v_installment
  from public.client_payment_installments
  where id = v_receipt.installment_id;
  if not found then raise exception 'Receipt instalment not found.'; end if;

  update public.client_payment_receipts set
    voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
  where id = p_receipt_id;

  insert into public.audit_activity_log (
    entity_type, entity_id, parent_entity_type, parent_entity_id,
    action, title, description, metadata, created_by
  ) values (
    'client_payment_receipt', p_receipt_id, 'quotation', p_quotation_id,
    'client_payment_receipt_voided',
    'Client payment receipt voided - ' || v_context.currency || ' ' || trim(to_char(v_receipt.amount_received, 'FM999999999999990D00')),
    'Receipt for ' || v_installment.title || ' was voided. Reason: ' || btrim(p_reason),
    jsonb_build_object(
      'orderNo', btrim(p_order_no),
      'scheduleId', v_receipt.schedule_id,
      'installmentId', v_installment.id,
      'receiptId', p_receipt_id,
      'amount', v_receipt.amount_received,
      'currency', v_context.currency,
      'paymentTitle', v_installment.title,
      'paymentMethod', v_receipt.payment_method,
      'eventCategory', 'Payment',
      'voided', true,
      'voidReason', btrim(p_reason)
    ),
    auth.uid()
  );
end;
$$;

revoke all on function public.record_client_payment_receipt(uuid, uuid, text, numeric, numeric, date, text, text, text, text, uuid, boolean) from public, anon;
revoke all on function public.void_client_payment_receipt(uuid, uuid, text, numeric, text) from public, anon;
grant execute on function public.record_client_payment_receipt(uuid, uuid, text, numeric, numeric, date, text, text, text, text, uuid, boolean) to authenticated;
grant execute on function public.void_client_payment_receipt(uuid, uuid, text, numeric, text) to authenticated;

drop policy if exists audit_activity_log_select_active_users on public.audit_activity_log;
create policy audit_activity_log_select_active_users
  on public.audit_activity_log for select to authenticated
  using (
    public.current_user_is_active()
    and (
      entity_type <> 'client_payment_receipt'
      or public.current_user_can_view_client_payments()
    )
  );

drop policy if exists audit_activity_log_insert_managers on public.audit_activity_log;
create policy audit_activity_log_insert_managers
  on public.audit_activity_log for insert to authenticated
  with check (
    public.current_user_can_manage_records()
    and (
      entity_type <> 'client_payment_receipt'
      or public.current_user_can_record_client_payment_receipts()
    )
  );

drop policy if exists audit_activity_log_update_managers on public.audit_activity_log;
create policy audit_activity_log_update_managers
  on public.audit_activity_log for update to authenticated
  using (
    public.current_user_can_manage_records()
    and (
      entity_type <> 'client_payment_receipt'
      or public.current_user_can_void_client_payment_receipts()
    )
  )
  with check (
    public.current_user_can_manage_records()
    and (
      entity_type <> 'client_payment_receipt'
      or public.current_user_can_void_client_payment_receipts()
    )
  );
