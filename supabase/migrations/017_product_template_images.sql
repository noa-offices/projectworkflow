alter table public.product_templates
add column if not exists image_settings jsonb not null default '{}'::jsonb;
