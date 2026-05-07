alter table public.quotation_items
add column if not exists allow_material_continuation_page boolean not null default false;
