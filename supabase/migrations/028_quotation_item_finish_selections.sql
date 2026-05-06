alter table public.quotation_items
add column if not exists finish_selections_snapshot jsonb not null default '[]'::jsonb;
