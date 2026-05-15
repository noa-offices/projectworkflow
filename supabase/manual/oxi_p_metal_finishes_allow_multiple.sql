-- One-time verification and correction for:
-- Product Template: Oxi_P
-- Material Group: Metal Finishes
--
-- Safe usage:
-- 1. Run the verification SELECT first.
-- 2. Confirm the returned row is the exact template/group you intend to change.
-- 3. Run the UPDATE only after verifying the row.
--
-- This script updates only the matching product_template_material_groups row.

-- Verify the exact linked row and current allow_multiple value
select
  ptmg.id as product_template_material_group_id,
  pt.id as product_template_id,
  pt.template_name,
  b.id as brand_id,
  b.name as brand_name,
  bmg.id as material_group_id,
  bmg.group_name,
  ptmg.allow_multiple,
  ptmg.selection_mode,
  ptmg.is_active,
  ptmg.updated_at
from public.product_template_material_groups as ptmg
join public.product_templates as pt
  on pt.id = ptmg.product_template_id
join public.brand_material_groups as bmg
  on bmg.id = ptmg.material_group_id
join public.brands as b
  on b.id = pt.brand_id
where pt.template_name = 'Oxi_P'
  and bmg.group_name = 'Metal Finishes'
order by ptmg.updated_at desc;

-- Optional safety check: this should return exactly 1 row before you update
select count(*) as matching_rows
from public.product_template_material_groups as ptmg
join public.product_templates as pt
  on pt.id = ptmg.product_template_id
join public.brand_material_groups as bmg
  on bmg.id = ptmg.material_group_id
where pt.template_name = 'Oxi_P'
  and bmg.group_name = 'Metal Finishes';

-- One-time update
-- Uncomment and run only after verifying the row above.
--
-- update public.product_template_material_groups as ptmg
-- set allow_multiple = true
-- from public.product_templates as pt,
--      public.brand_material_groups as bmg
-- where ptmg.product_template_id = pt.id
--   and ptmg.material_group_id = bmg.id
--   and pt.template_name = 'Oxi_P'
--   and bmg.group_name = 'Metal Finishes';

-- Re-check after update
-- select
--   ptmg.id as product_template_material_group_id,
--   pt.template_name,
--   bmg.group_name,
--   ptmg.allow_multiple,
--   ptmg.updated_at
-- from public.product_template_material_groups as ptmg
-- join public.product_templates as pt
--   on pt.id = ptmg.product_template_id
-- join public.brand_material_groups as bmg
--   on bmg.id = ptmg.material_group_id
-- where pt.template_name = 'Oxi_P'
--   and bmg.group_name = 'Metal Finishes';
