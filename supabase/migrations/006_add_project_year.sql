alter table public.projects
add column if not exists project_year integer;

create index if not exists projects_project_year_idx
on public.projects (project_year);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_project_year_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
    add constraint projects_project_year_check
    check (
      project_year is null
      or project_year between 2000 and 2100
    );
  end if;
end $$;
