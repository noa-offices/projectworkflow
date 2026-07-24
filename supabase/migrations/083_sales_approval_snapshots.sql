create table public.sales_approval_snapshots (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete restrict,
  quotation_folder_key text not null,
  approved_salesperson_id uuid not null references public.profiles(id) on delete restrict,
  source_type text not null,
  source_total numeric(14,2) not null,
  currency text not null,
  vat_amount numeric(14,2),
  amount_excluding_vat numeric(14,2),
  qualified_at timestamptz not null,
  source_created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint sales_approval_snapshots_source_type_check
    check (source_type in ('direct_project_file', 'client_approval_confirmed_order')),
  constraint sales_approval_snapshots_source_total_check
    check (source_total >= 0),
  constraint sales_approval_snapshots_folder_key_check
    check (btrim(quotation_folder_key) <> ''),
  constraint sales_approval_snapshots_currency_check
    check (btrim(currency) <> ''),
  constraint sales_approval_snapshots_vat_amount_check
    check (vat_amount is null or vat_amount >= 0),
  constraint sales_approval_snapshots_amount_excluding_vat_check
    check (amount_excluding_vat is null or amount_excluding_vat >= 0),
  constraint sales_approval_snapshots_folder_unique
    unique (quotation_folder_key)
);

comment on table public.sales_approval_snapshots is
  'Immutable commercial-value events captured when a quotation folder first receives a qualifying Project File.';
comment on column public.sales_approval_snapshots.source_total is
  'VAT-inclusive total stored by the qualifying Project File or confirmed order.';
comment on column public.sales_approval_snapshots.vat_amount is
  'VAT captured from the authoritative quotation calculation; null for legacy Client Approval drafts without a reliable VAT snapshot.';

alter table public.sales_approval_snapshots enable row level security;

revoke all on public.sales_approval_snapshots from anon, authenticated;
grant all on public.sales_approval_snapshots to service_role;

create or replace function public.capture_sales_approval_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_source_type text;
  snapshot_path text[];
  snapshot_folder_key text;
  snapshot_total numeric(14,2);
  snapshot_currency text;
  snapshot_vat_amount numeric(14,2);
  snapshot_qualified_at timestamptz;
  snapshot_created_by uuid;
begin
  if
    nullif(btrim(old.layout_settings #>> '{projectFile,orderNo}'), '') is null
    and nullif(btrim(new.layout_settings #>> '{projectFile,orderNo}'), '') is not null
  then
    snapshot_source_type := 'direct_project_file';
    snapshot_path := array['projectFile'];
  elsif
    nullif(btrim(old.layout_settings #>> '{clientApprovalDraft,confirmedOrder,orderNo}'), '') is null
    and nullif(btrim(new.layout_settings #>> '{clientApprovalDraft,confirmedOrder,orderNo}'), '') is not null
  then
    snapshot_source_type := 'client_approval_confirmed_order';
    snapshot_path := array['clientApprovalDraft', 'confirmedOrder'];
  else
    return new;
  end if;

  if new.approved_salesperson_id is null then
    raise exception 'Approved Sales Manager is required before capturing the commercial-value snapshot.';
  end if;

  snapshot_folder_key :=
    nullif(btrim(new.layout_settings #>> array_append(snapshot_path, 'quotationFolderKey')), '');
  snapshot_currency :=
    nullif(btrim(new.layout_settings #>> array_append(snapshot_path, 'currency')), '');

  if snapshot_folder_key is null or snapshot_currency is null then
    raise exception 'Approved commercial-value snapshot source metadata is incomplete.';
  end if;

  snapshot_total :=
    (new.layout_settings #>> array_append(snapshot_path, 'total'))::numeric(14,2);
  snapshot_vat_amount :=
    nullif(
      btrim(new.layout_settings #>> array_append(snapshot_path, 'vatAmount')),
      ''
    )::numeric(14,2);
  snapshot_qualified_at :=
    (new.layout_settings #>> array_append(snapshot_path, 'createdAt'))::timestamptz;
  snapshot_created_by :=
    nullif(
      btrim(new.layout_settings #>> array_append(snapshot_path, 'createdBy')),
      ''
    )::uuid;

  insert into public.sales_approval_snapshots (
    quotation_id,
    quotation_folder_key,
    approved_salesperson_id,
    source_type,
    source_total,
    currency,
    vat_amount,
    amount_excluding_vat,
    qualified_at,
    source_created_by
  )
  values (
    new.id,
    snapshot_folder_key,
    new.approved_salesperson_id,
    snapshot_source_type,
    snapshot_total,
    snapshot_currency,
    snapshot_vat_amount,
    case
      when snapshot_vat_amount is null then null
      else snapshot_total - snapshot_vat_amount
    end,
    snapshot_qualified_at,
    snapshot_created_by
  );

  return new;
end;
$$;

revoke all on function public.capture_sales_approval_snapshot() from public;

drop trigger if exists quotations_capture_sales_approval_snapshot on public.quotations;

create trigger quotations_capture_sales_approval_snapshot
before update of layout_settings, approved_salesperson_id on public.quotations
for each row
execute function public.capture_sales_approval_snapshot();

create or replace function public.prevent_sales_approval_snapshot_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Approved commercial-value snapshots are immutable.';
end;
$$;

revoke all on function public.prevent_sales_approval_snapshot_changes() from public;

create trigger sales_approval_snapshots_prevent_changes
before update or delete on public.sales_approval_snapshots
for each row
execute function public.prevent_sales_approval_snapshot_changes();
