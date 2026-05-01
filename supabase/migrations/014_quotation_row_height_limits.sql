alter table public.quotation_items
drop constraint if exists quotation_items_row_height_check;

update public.quotation_items
set row_height = null
where row_height is not null
  and (row_height < 40 or row_height > 600);

alter table public.quotation_items
add constraint quotation_items_row_height_check
check (row_height is null or row_height between 40 and 600);

alter table public.quotation_sections
drop constraint if exists quotation_sections_row_height_check;

update public.quotation_sections
set row_height = null
where row_height is not null
  and (row_height < 40 or row_height > 600);

alter table public.quotation_sections
add constraint quotation_sections_row_height_check
check (row_height is null or row_height between 40 and 600);
