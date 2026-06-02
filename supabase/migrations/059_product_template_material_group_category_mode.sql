alter table public.product_template_material_groups
drop constraint if exists product_template_material_groups_selection_mode_check;

alter table public.product_template_material_groups
add constraint product_template_material_groups_selection_mode_check
check (selection_mode in ('full_group', 'selected_categories', 'selected_items'));
