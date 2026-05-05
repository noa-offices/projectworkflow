alter table public.product_templates
add column if not exists accessory_pricing jsonb not null default '[]'::jsonb;
