create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_account_status() = 'active', false);
$$;

create table if not exists public.product_templates (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete restrict,
  main_category_id uuid references public.product_categories(id) on delete set null,
  sub_category_id uuid references public.product_categories(id) on delete set null,
  template_code text,
  template_name text not null,
  item_code text,
  description text,
  default_specification text,
  default_image_url text,
  reference_image_url text,
  unit_label text not null default 'Pc',
  currency text not null default 'AED',
  default_unit_price numeric(12,2) not null default 0,
  is_active boolean not null default true,
  last_price_checked_at timestamptz,
  last_price_checked_by uuid references auth.users(id),
  price_notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_components (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.product_templates(id) on delete cascade,
  option_type text not null default 'other',
  component_group text not null,
  component_code text,
  component_name text not null,
  description text,
  qty numeric(12,2) not null default 1,
  unit_label text not null default 'Pc',
  unit_price numeric(12,2) not null default 0,
  currency text not null default 'AED',
  is_optional boolean not null default true,
  is_default_selected boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  last_price_checked_at timestamptz,
  last_price_checked_by uuid references auth.users(id),
  price_notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_components
add column if not exists option_type text not null default 'other';

create index if not exists product_templates_brand_id_idx
on public.product_templates (brand_id);

create index if not exists product_templates_main_category_id_idx
on public.product_templates (main_category_id);

create index if not exists product_templates_sub_category_id_idx
on public.product_templates (sub_category_id);

create index if not exists product_components_template_id_idx
on public.product_components (template_id);

create index if not exists product_components_option_type_idx
on public.product_components (option_type);

create index if not exists product_components_component_group_idx
on public.product_components (component_group);

create unique index if not exists product_templates_brand_category_name_unique_idx
on public.product_templates (
  brand_id,
  coalesce(main_category_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(sub_category_id, '00000000-0000-0000-0000-000000000000'::uuid),
  lower(template_name)
);

create unique index if not exists product_components_template_group_name_unique_idx
on public.product_components (
  template_id,
  lower(component_group),
  lower(component_name)
);

drop trigger if exists product_templates_set_updated_at on public.product_templates;

create trigger product_templates_set_updated_at
before update on public.product_templates
for each row
execute function public.set_updated_at();

drop trigger if exists product_components_set_updated_at on public.product_components;

create trigger product_components_set_updated_at
before update on public.product_components
for each row
execute function public.set_updated_at();

alter table public.product_templates enable row level security;
alter table public.product_components enable row level security;

drop policy if exists product_templates_select_active on public.product_templates;

create policy product_templates_select_active
on public.product_templates
for select
to authenticated
using (
  is_active = true
  and public.current_user_is_active()
);

drop policy if exists product_templates_select_managers on public.product_templates;

create policy product_templates_select_managers
on public.product_templates
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists product_templates_insert_managers on public.product_templates;

create policy product_templates_insert_managers
on public.product_templates
for insert
to authenticated
with check (public.current_user_can_manage_settings());

drop policy if exists product_templates_update_managers on public.product_templates;

create policy product_templates_update_managers
on public.product_templates
for update
to authenticated
using (public.current_user_can_manage_settings())
with check (public.current_user_can_manage_settings());

drop policy if exists product_components_select_active on public.product_components;

create policy product_components_select_active
on public.product_components
for select
to authenticated
using (
  is_active = true
  and public.current_user_is_active()
);

drop policy if exists product_components_select_managers on public.product_components;

create policy product_components_select_managers
on public.product_components
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists product_components_insert_managers on public.product_components;

create policy product_components_insert_managers
on public.product_components
for insert
to authenticated
with check (public.current_user_can_manage_settings());

drop policy if exists product_components_update_managers on public.product_components;

create policy product_components_update_managers
on public.product_components
for update
to authenticated
using (public.current_user_can_manage_settings())
with check (public.current_user_can_manage_settings());

grant select, insert, update on public.product_templates to authenticated;
grant select, insert, update on public.product_components to authenticated;
grant execute on function public.current_user_is_active() to authenticated;
