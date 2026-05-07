create table if not exists public.company_settings (
  id uuid primary key default gen_random_uuid(),
  company_name text,
  display_name text,
  address_line_1 text,
  address_line_2 text,
  city text,
  country text,
  trn text,
  phone text,
  email text,
  website text,
  default_currency text not null default 'AED',
  vat_percent numeric not null default 5,
  logo_url text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists company_settings_singleton_idx
on public.company_settings ((true));

drop trigger if exists company_settings_set_updated_at on public.company_settings;

create trigger company_settings_set_updated_at
before update on public.company_settings
for each row
execute function public.set_updated_at();

alter table public.company_settings enable row level security;

drop policy if exists company_settings_select_active on public.company_settings;

create policy company_settings_select_active
on public.company_settings
for select
to authenticated
using (public.current_account_status() = 'active');

drop policy if exists company_settings_insert_managers on public.company_settings;

create policy company_settings_insert_managers
on public.company_settings
for insert
to authenticated
with check (public.current_user_can_manage_settings());

drop policy if exists company_settings_update_managers on public.company_settings;

create policy company_settings_update_managers
on public.company_settings
for update
to authenticated
using (public.current_user_can_manage_settings())
with check (public.current_user_can_manage_settings());

grant select, insert, update on public.company_settings to authenticated;
