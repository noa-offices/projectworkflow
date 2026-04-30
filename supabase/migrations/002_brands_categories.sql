create or replace function public.current_account_status()
returns public.account_status
language sql
stable
security definer
set search_path = public
as $$
  select account_status
  from public.profiles
  where id = auth.uid()
  limit 1;
$$;

create or replace function public.current_user_can_manage_settings()
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

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  description text,
  website text,
  logo_url text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  parent_id uuid references public.product_categories(id) on delete cascade,
  name text not null,
  code text,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists brands_name_unique_idx
on public.brands (lower(name));

create unique index if not exists product_categories_brand_parent_name_unique_idx
on public.product_categories (
  brand_id,
  coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
  lower(name)
);

create index if not exists product_categories_brand_id_idx
on public.product_categories (brand_id);

create index if not exists product_categories_parent_id_idx
on public.product_categories (parent_id);

drop trigger if exists brands_set_updated_at on public.brands;

create trigger brands_set_updated_at
before update on public.brands
for each row
execute function public.set_updated_at();

drop trigger if exists product_categories_set_updated_at on public.product_categories;

create trigger product_categories_set_updated_at
before update on public.product_categories
for each row
execute function public.set_updated_at();

alter table public.brands enable row level security;
alter table public.product_categories enable row level security;

drop policy if exists brands_select_active on public.brands;

create policy brands_select_active
on public.brands
for select
to authenticated
using (
  is_active = true
  and public.current_account_status() = 'active'
);

drop policy if exists brands_select_managers on public.brands;

create policy brands_select_managers
on public.brands
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists brands_insert_managers on public.brands;

create policy brands_insert_managers
on public.brands
for insert
to authenticated
with check (public.current_user_can_manage_settings());

drop policy if exists brands_update_managers on public.brands;

create policy brands_update_managers
on public.brands
for update
to authenticated
using (public.current_user_can_manage_settings())
with check (public.current_user_can_manage_settings());

drop policy if exists product_categories_select_active on public.product_categories;

create policy product_categories_select_active
on public.product_categories
for select
to authenticated
using (
  is_active = true
  and public.current_account_status() = 'active'
);

drop policy if exists product_categories_select_managers on public.product_categories;

create policy product_categories_select_managers
on public.product_categories
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists product_categories_insert_managers on public.product_categories;

create policy product_categories_insert_managers
on public.product_categories
for insert
to authenticated
with check (public.current_user_can_manage_settings());

drop policy if exists product_categories_update_managers on public.product_categories;

create policy product_categories_update_managers
on public.product_categories
for update
to authenticated
using (public.current_user_can_manage_settings())
with check (public.current_user_can_manage_settings());

grant select, insert, update on public.brands to authenticated;
grant select, insert, update on public.product_categories to authenticated;
grant execute on function public.current_account_status() to authenticated;
grant execute on function public.current_user_can_manage_settings() to authenticated;
