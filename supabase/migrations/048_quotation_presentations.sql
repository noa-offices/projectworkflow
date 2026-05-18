create table if not exists public.quotation_presentations (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists quotation_presentations_quotation_id_idx
on public.quotation_presentations (quotation_id);

drop trigger if exists quotation_presentations_set_updated_at on public.quotation_presentations;

create trigger quotation_presentations_set_updated_at
before update on public.quotation_presentations
for each row
execute function public.set_updated_at();

alter table public.quotation_presentations enable row level security;

drop policy if exists quotation_presentations_select_active on public.quotation_presentations;

create policy quotation_presentations_select_active
on public.quotation_presentations
for select
to authenticated
using (public.current_account_status() = 'active');

drop policy if exists quotation_presentations_insert_record_managers on public.quotation_presentations;

create policy quotation_presentations_insert_record_managers
on public.quotation_presentations
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists quotation_presentations_update_record_managers on public.quotation_presentations;

create policy quotation_presentations_update_record_managers
on public.quotation_presentations
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

grant select, insert, update on public.quotation_presentations to authenticated;
