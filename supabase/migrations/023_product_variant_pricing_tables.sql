alter table public.product_templates
add column if not exists variant_pricing jsonb not null default '[]'::jsonb,
add column if not exists category_pricing jsonb not null default '[]'::jsonb;
