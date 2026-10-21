begin;

-- Material Library redesign, Phase 1 (additive only): Brand > Group > OPTIONAL Sub-group > Material.
--  * New table brand_material_subgroups (a sub-group belongs to exactly one group; grade is an optional label such as "CAT A").
--  * brand_materials.subgroup_id (nullable; null = the material sits directly in its group).
--  * brand_materials.review_status ('confirmed' | 'needs_review'); every existing row becomes 'confirmed'.
--  * Nothing is dropped, renamed or changed: material_category / material_collection stay exactly as they are.
-- RLS on the new table copies brand_material_groups (029 + the sales coordinator policies of 081): read for active users (active rows)
-- and for record managers / sales coordinators, insert/update for record managers and sales coordinators, delete policy for sales
-- coordinators (no DELETE grant, same as the groups table). Helper calls are wrapped in a scalar select so they run once per query.
-- Not run against a database when written.

create table if not exists public.brand_material_subgroups (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  material_group_id uuid not null references public.brand_material_groups(id) on delete cascade,
  name text not null,
  grade text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_material_subgroups_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists brand_material_subgroups_group_name_grade_key
on public.brand_material_subgroups (material_group_id, lower(name), lower(coalesce(grade, '')));

create index if not exists brand_material_subgroups_brand_id_idx
on public.brand_material_subgroups (brand_id);

create index if not exists brand_material_subgroups_material_group_id_idx
on public.brand_material_subgroups (material_group_id);

drop trigger if exists brand_material_subgroups_set_updated_at on public.brand_material_subgroups;

create trigger brand_material_subgroups_set_updated_at
before update on public.brand_material_subgroups
for each row
execute function public.set_updated_at();

alter table public.brand_materials
add column if not exists subgroup_id uuid references public.brand_material_subgroups(id) on delete set null;

create index if not exists brand_materials_subgroup_id_idx
on public.brand_materials (subgroup_id);

alter table public.brand_materials
add column if not exists review_status text not null default 'confirmed';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'brand_materials_review_status_check') then
    alter table public.brand_materials
    add constraint brand_materials_review_status_check check (review_status in ('confirmed', 'needs_review'));
  end if;
end;
$$;

-- Consistency (applies to every writer, including the sales coordinator policies, which have no brand check of their own):
--  * a sub-group's brand must be its group's brand;
--  * a material's sub-group must belong to the material's group. When a material is moved to another group and its sub-group is left
--    unchanged, the sub-group is cleared (the material sits directly in the new group) instead of failing the existing move.
-- SECURITY DEFINER only for the two lookups, so a row hidden by RLS (for example an inactive group) cannot cause a false failure.
create or replace function public.brand_material_subgroup_brand_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.brand_material_groups as groups
    where groups.id = new.material_group_id and groups.brand_id = new.brand_id
  ) then
    raise exception 'Sub-group brand must match its material group brand';
  end if;
  return new;
end;
$$;

drop trigger if exists brand_material_subgroups_brand_check on public.brand_material_subgroups;

create trigger brand_material_subgroups_brand_check
before insert or update of brand_id, material_group_id on public.brand_material_subgroups
for each row
execute function public.brand_material_subgroup_brand_check();

create or replace function public.brand_material_subgroup_group_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.subgroup_id is null then
    return new;
  end if;
  if exists (
    select 1 from public.brand_material_subgroups as subgroups
    where subgroups.id = new.subgroup_id and subgroups.material_group_id = new.material_group_id
  ) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.material_group_id is distinct from old.material_group_id and new.subgroup_id is not distinct from old.subgroup_id then
    new.subgroup_id := null;
    return new;
  end if;
  raise exception 'Material sub-group must belong to the material group';
end;
$$;

drop trigger if exists brand_materials_subgroup_group_check on public.brand_materials;

create trigger brand_materials_subgroup_group_check
before insert or update of subgroup_id, material_group_id on public.brand_materials
for each row
execute function public.brand_material_subgroup_group_check();

revoke all on function public.brand_material_subgroup_brand_check() from public, anon;
revoke all on function public.brand_material_subgroup_group_check() from public, anon;

alter table public.brand_material_subgroups enable row level security;

drop policy if exists brand_material_subgroups_select_active on public.brand_material_subgroups;

create policy brand_material_subgroups_select_active
on public.brand_material_subgroups
for select
to authenticated
using (
  is_active = true
  and (select public.current_user_is_active())
);

drop policy if exists brand_material_subgroups_select_managers on public.brand_material_subgroups;

create policy brand_material_subgroups_select_managers
on public.brand_material_subgroups
for select
to authenticated
using ((select public.current_user_can_manage_records()));

drop policy if exists brand_material_subgroups_insert_managers on public.brand_material_subgroups;

create policy brand_material_subgroups_insert_managers
on public.brand_material_subgroups
for insert
to authenticated
with check ((select public.current_user_can_manage_records()));

drop policy if exists brand_material_subgroups_update_managers on public.brand_material_subgroups;

create policy brand_material_subgroups_update_managers
on public.brand_material_subgroups
for update
to authenticated
using ((select public.current_user_can_manage_records()))
with check ((select public.current_user_can_manage_records()));

drop policy if exists sc_brand_material_subgroups_select on public.brand_material_subgroups;

create policy sc_brand_material_subgroups_select
on public.brand_material_subgroups
for select
to authenticated
using ((select public.current_user_is_sales_coordinator()));

drop policy if exists sc_brand_material_subgroups_insert on public.brand_material_subgroups;

create policy sc_brand_material_subgroups_insert
on public.brand_material_subgroups
for insert
to authenticated
with check ((select public.current_user_is_sales_coordinator()));

drop policy if exists sc_brand_material_subgroups_update on public.brand_material_subgroups;

create policy sc_brand_material_subgroups_update
on public.brand_material_subgroups
for update
to authenticated
using ((select public.current_user_is_sales_coordinator()))
with check ((select public.current_user_is_sales_coordinator()));

drop policy if exists sc_brand_material_subgroups_delete on public.brand_material_subgroups;

create policy sc_brand_material_subgroups_delete
on public.brand_material_subgroups
for delete
to authenticated
using ((select public.current_user_is_sales_coordinator()));

grant select, insert, update on public.brand_material_subgroups to authenticated;

commit;
