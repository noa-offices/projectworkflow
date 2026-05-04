alter table public.product_templates
add column if not exists desking_size_pricing jsonb not null default '[]'::jsonb;
