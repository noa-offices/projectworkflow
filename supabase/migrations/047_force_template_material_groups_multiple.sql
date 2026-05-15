alter table public.product_template_material_groups
alter column allow_multiple set default true;

update public.product_template_material_groups
set allow_multiple = true
where allow_multiple is distinct from true;
