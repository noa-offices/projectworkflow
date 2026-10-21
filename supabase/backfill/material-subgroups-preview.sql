-- READ ONLY preview for material-subgroups-backfill.sql. No writes.
-- Rule: collection not empty -> sub-group name = collection, grade = category (or null);
--       collection empty, category not empty -> sub-group name = category, grade = null;
--       both empty -> no sub-group (the material stays directly in its group).
-- Names and grades are trimmed and compared case-insensitively.

with classified as (
  select
    m.id,
    m.material_group_id,
    nullif(btrim(m.material_collection), '') as collection,
    nullif(btrim(m.material_category), '') as category
  from public.brand_materials as m
),
proposed as (
  select
    c.id,
    c.material_group_id,
    coalesce(c.collection, c.category) as subgroup_name,
    case when c.collection is not null then c.category end as subgroup_grade
  from classified as c
)

-- 1) Sub-groups that would be created, with how many materials go into each (per brand and group).
select
  b.name as brand_name,
  g.group_name,
  min(p.subgroup_name) as subgroup_name,
  min(p.subgroup_grade) as subgroup_grade,
  count(*) as material_count,
  exists (
    select 1 from public.brand_material_subgroups as s
    where s.material_group_id = p.material_group_id
      and lower(s.name) = lower(p.subgroup_name)
      and lower(coalesce(s.grade, '')) = lower(coalesce(p.subgroup_grade, ''))
  ) as already_exists
from proposed as p
join public.brand_material_groups as g on g.id = p.material_group_id
join public.brands as b on b.id = g.brand_id
where p.subgroup_name is not null
group by b.name, g.group_name, p.material_group_id, lower(p.subgroup_name), lower(coalesce(p.subgroup_grade, ''))
order by b.name, g.group_name, lower(p.subgroup_name), lower(coalesce(p.subgroup_grade, ''));

-- 2) Materials that stay directly in their group (no collection and no category), per brand and group.
select
  b.name as brand_name,
  g.group_name,
  count(*) as materials_without_subgroup
from public.brand_materials as m
join public.brand_material_groups as g on g.id = m.material_group_id
join public.brands as b on b.id = g.brand_id
where nullif(btrim(m.material_collection), '') is null
  and nullif(btrim(m.material_category), '') is null
group by b.name, g.group_name
order by b.name, g.group_name;

-- 3) Totals.
select
  count(*) as all_materials,
  count(*) filter (where nullif(btrim(material_collection), '') is not null or nullif(btrim(material_category), '') is not null) as materials_getting_a_subgroup,
  count(*) filter (where nullif(btrim(material_collection), '') is null and nullif(btrim(material_category), '') is null) as materials_staying_in_group,
  count(*) filter (where subgroup_id is not null) as materials_already_linked
from public.brand_materials;

-- 4) Sanity check: materials whose brand differs from their group's brand (these would still get a sub-group under the GROUP's brand).
select m.id, m.brand_id as material_brand_id, g.brand_id as group_brand_id
from public.brand_materials as m
join public.brand_material_groups as g on g.id = m.material_group_id
where m.brand_id <> g.brand_id;
