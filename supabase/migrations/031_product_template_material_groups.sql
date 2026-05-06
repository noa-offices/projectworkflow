create table if not exists public.product_template_material_groups (
  id uuid primary key default gen_random_uuid(),
  product_template_id uuid not null references public.product_templates(id) on delete cascade,
  material_group_id uuid not null references public.brand_material_groups(id) on delete cascade,
  label_override text,
  is_required boolean not null default false,
  allow_multiple boolean not null default false,
  show_in_specification boolean not null default true,
  show_in_quotation boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_template_material_groups_unique unique (product_template_id, material_group_id)
);

create index if not exists product_template_material_groups_template_id_idx
on public.product_template_material_groups (product_template_id);

create index if not exists product_template_material_groups_material_group_id_idx
on public.product_template_material_groups (material_group_id);

drop trigger if exists product_template_material_groups_set_updated_at on public.product_template_material_groups;

create trigger product_template_material_groups_set_updated_at
before update on public.product_template_material_groups
for each row
execute function public.set_updated_at();

alter table public.product_template_material_groups enable row level security;

drop policy if exists product_template_material_groups_select_active on public.product_template_material_groups;

create policy product_template_material_groups_select_active
on public.product_template_material_groups
for select
to authenticated
using (
  is_active = true
  and public.current_user_is_active()
);

drop policy if exists product_template_material_groups_select_managers on public.product_template_material_groups;

create policy product_template_material_groups_select_managers
on public.product_template_material_groups
for select
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists product_template_material_groups_insert_managers on public.product_template_material_groups;

create policy product_template_material_groups_insert_managers
on public.product_template_material_groups
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists product_template_material_groups_update_managers on public.product_template_material_groups;

create policy product_template_material_groups_update_managers
on public.product_template_material_groups
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

grant select, insert, update on public.product_template_material_groups to authenticated;
