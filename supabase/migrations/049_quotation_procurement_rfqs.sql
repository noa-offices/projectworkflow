create table if not exists public.quotation_procurement_rfqs (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists quotation_procurement_rfqs_quotation_id_idx
on public.quotation_procurement_rfqs (quotation_id);

drop trigger if exists quotation_procurement_rfqs_set_updated_at on public.quotation_procurement_rfqs;

create trigger quotation_procurement_rfqs_set_updated_at
before update on public.quotation_procurement_rfqs
for each row
execute function public.set_updated_at();

alter table public.quotation_procurement_rfqs enable row level security;

drop policy if exists quotation_procurement_rfqs_select_active on public.quotation_procurement_rfqs;

create policy quotation_procurement_rfqs_select_active
on public.quotation_procurement_rfqs
for select
to authenticated
using (public.current_account_status() = 'active');

drop policy if exists quotation_procurement_rfqs_insert_record_managers on public.quotation_procurement_rfqs;

create policy quotation_procurement_rfqs_insert_record_managers
on public.quotation_procurement_rfqs
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists quotation_procurement_rfqs_update_record_managers on public.quotation_procurement_rfqs;

create policy quotation_procurement_rfqs_update_record_managers
on public.quotation_procurement_rfqs
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

grant select, insert, update on public.quotation_procurement_rfqs to authenticated;
