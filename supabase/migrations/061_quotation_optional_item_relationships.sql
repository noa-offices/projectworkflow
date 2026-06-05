alter table public.quotation_items
add column if not exists parent_item_id uuid references public.quotation_items(id) on delete set null,
add column if not exists include_in_total boolean not null default true;

update public.quotation_items
set include_in_total = false
where is_optional = true
  and include_in_total = true;

create index if not exists quotation_items_parent_item_id_idx
on public.quotation_items (parent_item_id);
