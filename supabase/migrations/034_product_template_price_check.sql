alter table public.product_templates
add column if not exists last_price_checked_at timestamptz;

alter table public.product_templates
add column if not exists last_price_checked_by uuid references public.profiles(id);

alter table public.product_templates
add column if not exists price_check_note text;

alter table public.product_templates
add column if not exists price_check_interval_days integer not null default 90;
