alter table public.brand_materials
add column if not exists material_category text;

alter table public.brand_materials
add column if not exists image_alt text;
