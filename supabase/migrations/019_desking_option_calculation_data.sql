alter table public.product_components
add column if not exists calculation_data jsonb not null default '{}'::jsonb;
