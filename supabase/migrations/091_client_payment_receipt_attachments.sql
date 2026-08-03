insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-payment-receipts',
  'client-payment-receipts',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies are created for this bucket. All object access is
-- performed by trusted server actions after payment-specific authorization.

create or replace function public.client_payment_receipt_attachment_context(
  p_receipt_id uuid,
  p_quotation_id uuid,
  p_order_no text
)
returns table (receipt_id uuid, receipt_voided boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_can_view_client_payments() then
    raise exception 'Forbidden.';
  end if;

  return query
  select r.id, r.voided_at is not null
  from public.client_payment_receipts r
  join public.client_payment_installments i
    on i.id = r.installment_id
   and i.schedule_id = r.schedule_id
  join public.client_payment_schedules s on s.id = r.schedule_id
  where r.id = p_receipt_id
    and s.quotation_id = p_quotation_id
    and s.order_no = btrim(p_order_no);

  if not found then raise exception 'Receipt does not belong to this Project File.'; end if;
end;
$$;

create or replace function public.add_client_payment_receipt_attachment_metadata(
  p_attachment_id uuid,
  p_receipt_id uuid,
  p_quotation_id uuid,
  p_order_no text,
  p_file_name text,
  p_safe_file_name text,
  p_storage_path text,
  p_mime_type text,
  p_file_size_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_expected_path text;
begin
  if not public.current_user_can_record_client_payment_receipts() then raise exception 'Forbidden.'; end if;
  select * into v_context
  from public.client_payment_receipt_attachment_context(p_receipt_id, p_quotation_id, p_order_no);
  if v_context.receipt_voided then raise exception 'Attachments cannot be added to a voided receipt.'; end if;

  if p_attachment_id is null then raise exception 'Attachment ID is required.'; end if;
  if btrim(p_order_no) !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid Project File number.'; end if;
  if nullif(btrim(p_file_name), '') is null or length(p_file_name) > 255 then raise exception 'Invalid original filename.'; end if;
  if p_file_name ~ '[[:cntrl:]/]' or position(chr(92) in p_file_name) > 0 then raise exception 'Invalid original filename.'; end if;
  if p_safe_file_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$' or p_safe_file_name like '%..%' then
    raise exception 'Invalid safe filename.';
  end if;
  if p_mime_type not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') then raise exception 'Unsupported file type.'; end if;
  if (p_mime_type = 'application/pdf' and p_safe_file_name <> 'receipt-evidence.pdf')
    or (p_mime_type = 'image/png' and p_safe_file_name <> 'receipt-evidence.png')
    or (p_mime_type = 'image/jpeg' and p_safe_file_name not in ('receipt-evidence.jpg', 'receipt-evidence.jpeg'))
    or (p_mime_type = 'image/webp' and p_safe_file_name <> 'receipt-evidence.webp') then
    raise exception 'Safe filename does not match the file type.';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 10485760 then raise exception 'Invalid file size.'; end if;

  v_expected_path := format(
    'projects/%s/receipts/%s/%s-%s',
    btrim(p_order_no), p_receipt_id, p_attachment_id, p_safe_file_name
  );
  if p_storage_path <> v_expected_path then raise exception 'Attachment storage path is invalid.'; end if;

  insert into public.client_payment_receipt_attachments (
    id, receipt_id, file_name, storage_path, mime_type, file_size_bytes, created_by
  ) values (
    p_attachment_id, p_receipt_id, p_file_name, p_storage_path,
    p_mime_type, p_file_size_bytes, auth.uid()
  );
end;
$$;

create or replace function public.get_client_payment_receipt_attachment(
  p_attachment_id uuid,
  p_receipt_id uuid,
  p_quotation_id uuid,
  p_order_no text
)
returns table (
  attachment_id uuid,
  file_name text,
  storage_path text,
  mime_type text,
  file_size_bytes bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_can_view_client_payments() then raise exception 'Forbidden.'; end if;

  return query
  select a.id, a.file_name, a.storage_path, a.mime_type, a.file_size_bytes
  from public.client_payment_receipt_attachments a
  join public.client_payment_receipts r on r.id = a.receipt_id
  join public.client_payment_installments i
    on i.id = r.installment_id
   and i.schedule_id = r.schedule_id
  join public.client_payment_schedules s on s.id = r.schedule_id
  where a.id = p_attachment_id
    and a.receipt_id = p_receipt_id
    and s.quotation_id = p_quotation_id
    and s.order_no = btrim(p_order_no);

  if not found then raise exception 'Attachment does not belong to this Project File receipt.'; end if;
end;
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
  if not public.current_user_can_void_client_payment_receipts() then raise exception 'Forbidden.'; end if;

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

  if not found then raise exception 'Attachment does not belong to this Project File receipt.'; end if;
end;
$$;

revoke all on function public.client_payment_receipt_attachment_context(uuid, uuid, text) from public, anon;
revoke all on function public.add_client_payment_receipt_attachment_metadata(uuid, uuid, uuid, text, text, text, text, text, bigint) from public, anon;
revoke all on function public.get_client_payment_receipt_attachment(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.remove_client_payment_receipt_attachment_metadata(uuid, uuid, uuid, text) from public, anon;

grant execute on function public.client_payment_receipt_attachment_context(uuid, uuid, text) to authenticated;
grant execute on function public.add_client_payment_receipt_attachment_metadata(uuid, uuid, uuid, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.get_client_payment_receipt_attachment(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.remove_client_payment_receipt_attachment_metadata(uuid, uuid, uuid, text) to authenticated;
