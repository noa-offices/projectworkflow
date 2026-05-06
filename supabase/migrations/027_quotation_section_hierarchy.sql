alter table public.quotation_sections
add column if not exists parent_section_id uuid references public.quotation_sections(id) on delete set null,
add column if not exists section_kind text not null default 'sub';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_sections_section_kind_check'
      and conrelid = 'public.quotation_sections'::regclass
  ) then
    alter table public.quotation_sections
    add constraint quotation_sections_section_kind_check
    check (section_kind in ('main', 'sub'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_sections_kind_parent_check'
      and conrelid = 'public.quotation_sections'::regclass
  ) then
    alter table public.quotation_sections
    add constraint quotation_sections_kind_parent_check
    check (
      (section_kind = 'main' and parent_section_id is null)
      or section_kind = 'sub'
    );
  end if;
end $$;

update public.quotation_sections
set section_kind = 'sub',
    parent_section_id = null
where section_kind is null;

drop index if exists public.quotation_sections_active_title_unique_idx;

create index if not exists quotation_sections_parent_section_id_idx
on public.quotation_sections (parent_section_id);

create index if not exists quotation_sections_kind_sort_idx
on public.quotation_sections (quotation_id, section_kind, sort_order);
