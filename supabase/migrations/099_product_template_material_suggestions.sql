alter table public.product_templates
add column if not exists material_suggestions jsonb;
