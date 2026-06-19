create table if not exists public.quotation_delivery_notes (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  dn_number text not null default '',
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists quotation_delivery_notes_quotation_id_idx
on public.quotation_delivery_notes (quotation_id);

drop trigger if exists quotation_delivery_notes_set_updated_at on public.quotation_delivery_notes;

create trigger quotation_delivery_notes_set_updated_at
before update on public.quotation_delivery_notes
for each row
execute function public.set_updated_at();

alter table public.quotation_delivery_notes enable row level security;

drop policy if exists quotation_delivery_notes_select_active on public.quotation_delivery_notes;

create policy quotation_delivery_notes_select_active
on public.quotation_delivery_notes
for select
to authenticated
using (public.current_account_status() = 'active');

drop policy if exists quotation_delivery_notes_insert_record_managers on public.quotation_delivery_notes;

create policy quotation_delivery_notes_insert_record_managers
on public.quotation_delivery_notes
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists quotation_delivery_notes_update_record_managers on public.quotation_delivery_notes;

create policy quotation_delivery_notes_update_record_managers
on public.quotation_delivery_notes
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

grant select, insert, update on public.quotation_delivery_notes to authenticated;
grant select, insert, update, delete on public.quotation_delivery_notes to service_role;
