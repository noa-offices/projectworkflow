alter table public.quotation_items
add column if not exists cell_layout jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_items_cell_layout_merge_mode_check'
      and conrelid = 'public.quotation_items'::regclass
  ) then
    alter table public.quotation_items
    add constraint quotation_items_cell_layout_merge_mode_check
    check (
      not (cell_layout ? 'mergeMode')
      or cell_layout->>'mergeMode' in ('none', 'merge_specification', 'merge_full_row')
    );
  end if;
end $$;
