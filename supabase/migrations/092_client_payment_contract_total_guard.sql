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
