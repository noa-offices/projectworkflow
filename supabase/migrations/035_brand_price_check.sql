alter table public.brands
add column if not exists last_price_list_checked_at timestamptz;

alter table public.brands
add column if not exists last_price_list_checked_by uuid references public.profiles(id);

alter table public.brands
add column if not exists price_list_check_note text;

alter table public.brands
add column if not exists price_list_check_interval_days integer not null default 90;
