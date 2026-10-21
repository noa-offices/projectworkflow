-- Backfill for 20261020090000_brand_material_subgroups.sql. Run AFTER the migration and AFTER checking
-- material-subgroups-preview.sql. Run as the database owner (SQL editor / service role), so RLS does not hide rows.
-- Safe to run twice: step 1 skips sub-groups that already exist (unique index), step 2 only fills materials whose subgroup_id is null.
-- Two plain statements (no explicit long transaction). The old text columns material_category / material_collection are never changed.
-- Note: step 2 updates rows in brand_materials, so their updated_at is refreshed by the existing set_updated_at trigger.
-- Rule: collection not empty -> name = collection, grade = category (or null); collection empty, category not empty -> name = category,
-- grade = null; both empty -> no sub-group. Trimmed, compared case-insensitively.

-- 1) Create the sub-groups (one per group + name + grade; first-seen spelling wins).
insert into public.brand_material_subgroups (brand_id, material_group_id, name, grade, sort_order)
select brand_id, material_group_id, subgroup_name, subgroup_grade, 0
from (
  select distinct on (p.material_group_id, lower(p.subgroup_name), lower(coalesce(p.subgroup_grade, '')))
    g.brand_id,
    p.material_group_id,
    p.subgroup_name,
    p.subgroup_grade
  from (
    select
      m.material_group_id,
      m.created_at,
      m.id,
      coalesce(nullif(btrim(m.material_collection), ''), nullif(btrim(m.material_category), '')) as subgroup_name,
      case when nullif(btrim(m.material_collection), '') is not null then nullif(btrim(m.material_category), '') end as subgroup_grade
    from public.brand_materials as m
  ) as p
  join public.brand_material_groups as g on g.id = p.material_group_id
  where p.subgroup_name is not null
  order by p.material_group_id, lower(p.subgroup_name), lower(coalesce(p.subgroup_grade, '')), p.created_at, p.id
) as distinct_subgroups
on conflict do nothing;

-- 2) Link materials to their sub-group (only where not linked yet).
update public.brand_materials as m
set subgroup_id = s.id
from public.brand_material_subgroups as s
where m.subgroup_id is null
  and s.material_group_id = m.material_group_id
  and coalesce(nullif(btrim(m.material_collection), ''), nullif(btrim(m.material_category), '')) is not null
  and lower(s.name) = lower(coalesce(nullif(btrim(m.material_collection), ''), nullif(btrim(m.material_category), '')))
  and lower(coalesce(s.grade, '')) = lower(coalesce(case when nullif(btrim(m.material_collection), '') is not null then nullif(btrim(m.material_category), '') end, ''));

-- Check: should return 0 rows (every categorized material is linked).
select count(*) as categorized_but_unlinked
from public.brand_materials
where subgroup_id is null
  and (nullif(btrim(material_collection), '') is not null or nullif(btrim(material_category), '') is not null);
