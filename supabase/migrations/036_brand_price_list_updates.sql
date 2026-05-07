create table if not exists public.brand_price_list_updates (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  title text not null,
  reference_no text,
  currency text,
  effective_from date,
  received_at date,
  status text not null default 'draft',
  notes text,
  attachment_url text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_price_list_updates_status_check check (status in ('draft', 'active', 'archived'))
);

create index if not exists brand_price_list_updates_brand_id_idx
on public.brand_price_list_updates (brand_id);

create index if not exists brand_price_list_updates_status_idx
on public.brand_price_list_updates (status);

drop trigger if exists brand_price_list_updates_set_updated_at on public.brand_price_list_updates;

create trigger brand_price_list_updates_set_updated_at
before update on public.brand_price_list_updates
for each row
execute function public.set_updated_at();

alter table public.brand_price_list_updates enable row level security;

drop policy if exists brand_price_list_updates_select_active_users on public.brand_price_list_updates;

create policy brand_price_list_updates_select_active_users
on public.brand_price_list_updates
for select
to authenticated
using (
  status in ('draft', 'active')
  and public.current_user_is_active()
);

drop policy if exists brand_price_list_updates_select_managers on public.brand_price_list_updates;

create policy brand_price_list_updates_select_managers
on public.brand_price_list_updates
for select
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists brand_price_list_updates_insert_managers on public.brand_price_list_updates;

create policy brand_price_list_updates_insert_managers
on public.brand_price_list_updates
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists brand_price_list_updates_update_managers on public.brand_price_list_updates;

create policy brand_price_list_updates_update_managers
on public.brand_price_list_updates
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

grant select, insert, update on public.brand_price_list_updates to authenticated;
