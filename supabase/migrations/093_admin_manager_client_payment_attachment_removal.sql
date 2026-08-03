create or replace function public.current_user_can_manage_client_payment_receipt_attachments()
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

create or replace function public.remove_client_payment_receipt_attachment_metadata(
  p_attachment_id uuid,
  p_receipt_id uuid,
  p_quotation_id uuid,
  p_order_no text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_can_manage_client_payment_receipt_attachments() then
    raise exception 'Forbidden.';
  end if;

  delete from public.client_payment_receipt_attachments a
  using public.client_payment_receipts r, public.client_payment_installments i, public.client_payment_schedules s
  where a.id = p_attachment_id
    and a.receipt_id = p_receipt_id
    and r.id = a.receipt_id
    and i.id = r.installment_id
    and i.schedule_id = r.schedule_id
    and s.id = r.schedule_id
    and s.quotation_id = p_quotation_id
    and s.order_no = btrim(p_order_no);

  if not found then
    raise exception 'Attachment does not belong to this Project File receipt.';
  end if;
end;
$$;

revoke all on function public.current_user_can_manage_client_payment_receipt_attachments() from public, anon;
revoke all on function public.remove_client_payment_receipt_attachment_metadata(uuid, uuid, uuid, text) from public, anon;

grant execute on function public.current_user_can_manage_client_payment_receipt_attachments() to authenticated;
grant execute on function public.remove_client_payment_receipt_attachment_metadata(uuid, uuid, uuid, text) to authenticated;
