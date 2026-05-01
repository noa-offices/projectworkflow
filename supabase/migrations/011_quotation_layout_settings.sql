alter table public.quotations
add column if not exists layout_settings jsonb not null default '{}'::jsonb;

alter table public.quotation_items
add column if not exists row_height integer;

alter table public.quotation_sections
add column if not exists row_height integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_items_row_height_check'
      and conrelid = 'public.quotation_items'::regclass
  ) then
    alter table public.quotation_items
    add constraint quotation_items_row_height_check
    check (row_height is null or row_height between 24 and 500);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_sections_row_height_check'
      and conrelid = 'public.quotation_sections'::regclass
  ) then
    alter table public.quotation_sections
    add constraint quotation_sections_row_height_check
    check (row_height is null or row_height between 24 and 500);
  end if;
end $$;
