-- Rollback for 20261020090000_brand_material_subgroups.sql. Removes ONLY what that migration added.
-- WARNING: this deletes all sub-groups and the subgroup_id / review_status values (the old text columns are untouched).
begin;

drop trigger if exists brand_materials_subgroup_group_check on public.brand_materials;
drop function if exists public.brand_material_subgroup_group_check();

alter table public.brand_materials drop constraint if exists brand_materials_review_status_check;
alter table public.brand_materials drop column if exists review_status;

drop index if exists public.brand_materials_subgroup_id_idx;
alter table public.brand_materials drop column if exists subgroup_id;

-- Dropping the table also drops its policies, indexes and triggers.
drop table if exists public.brand_material_subgroups;
drop function if exists public.brand_material_subgroup_brand_check();

commit;
