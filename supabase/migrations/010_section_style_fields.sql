alter table public.quotation_sections
add column if not exists title_align text not null default 'center',
add column if not exists title_bold boolean not null default true,
add column if not exists title_bg text not null default 'light_grey',
add column if not exists title_size text not null default 'normal';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_sections_title_align_check'
      and conrelid = 'public.quotation_sections'::regclass
  ) then
    alter table public.quotation_sections
    add constraint quotation_sections_title_align_check
    check (title_align in ('left', 'center', 'right'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_sections_title_bg_check'
      and conrelid = 'public.quotation_sections'::regclass
  ) then
    alter table public.quotation_sections
    add constraint quotation_sections_title_bg_check
    check (title_bg in ('light_grey', 'white', 'dark_grey'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_sections_title_size_check'
      and conrelid = 'public.quotation_sections'::regclass
  ) then
    alter table public.quotation_sections
    add constraint quotation_sections_title_size_check
    check (title_size in ('normal', 'large'));
  end if;
end $$;
