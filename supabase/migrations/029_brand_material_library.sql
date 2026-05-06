create table if not exists public.brand_material_groups (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  group_name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brand_materials (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  material_group_id uuid not null references public.brand_material_groups(id) on delete cascade,
  material_code text,
  material_name text not null,
  color_family text,
  description text,
  image_url text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_material_groups_brand_id_idx
on public.brand_material_groups (brand_id);

create index if not exists brand_materials_brand_id_idx
on public.brand_materials (brand_id);

create index if not exists brand_materials_material_group_id_idx
on public.brand_materials (material_group_id);

drop trigger if exists brand_material_groups_set_updated_at on public.brand_material_groups;

create trigger brand_material_groups_set_updated_at
before update on public.brand_material_groups
for each row
execute function public.set_updated_at();

drop trigger if exists brand_materials_set_updated_at on public.brand_materials;

create trigger brand_materials_set_updated_at
before update on public.brand_materials
for each row
execute function public.set_updated_at();

alter table public.brand_material_groups enable row level security;
alter table public.brand_materials enable row level security;

drop policy if exists brand_material_groups_select_active on public.brand_material_groups;

create policy brand_material_groups_select_active
on public.brand_material_groups
for select
to authenticated
using (
  is_active = true
  and public.current_user_is_active()
);

drop policy if exists brand_material_groups_select_managers on public.brand_material_groups;

create policy brand_material_groups_select_managers
on public.brand_material_groups
for select
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists brand_material_groups_insert_managers on public.brand_material_groups;

create policy brand_material_groups_insert_managers
on public.brand_material_groups
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists brand_material_groups_update_managers on public.brand_material_groups;

create policy brand_material_groups_update_managers
on public.brand_material_groups
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

drop policy if exists brand_materials_select_active on public.brand_materials;

create policy brand_materials_select_active
on public.brand_materials
for select
to authenticated
using (
  is_active = true
  and public.current_user_is_active()
);

drop policy if exists brand_materials_select_managers on public.brand_materials;

create policy brand_materials_select_managers
on public.brand_materials
for select
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists brand_materials_insert_managers on public.brand_materials;

create policy brand_materials_insert_managers
on public.brand_materials
for insert
to authenticated
with check (
  public.current_user_can_manage_records()
  and exists (
    select 1
    from public.brand_material_groups as groups
    where groups.id = brand_materials.material_group_id
      and groups.brand_id = brand_materials.brand_id
  )
);

drop policy if exists brand_materials_update_managers on public.brand_materials;

create policy brand_materials_update_managers
on public.brand_materials
for update
to authenticated
using (public.current_user_can_manage_records())
with check (
  public.current_user_can_manage_records()
  and exists (
    select 1
    from public.brand_material_groups as groups
    where groups.id = brand_materials.material_group_id
      and groups.brand_id = brand_materials.brand_id
  )
);

grant select, insert, update on public.brand_material_groups to authenticated;
grant select, insert, update on public.brand_materials to authenticated;
