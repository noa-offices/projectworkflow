alter table public.clients
add column if not exists client_number text;

alter table public.projects
add column if not exists project_sequence integer;

alter table public.projects
add column if not exists project_number text;

alter table public.quotations
add column if not exists legacy_reference text;

create sequence if not exists public.client_number_seq start 100;

create or replace function public.format_project_number(client_number text, project_sequence integer)
returns text
language sql
immutable
as $$
  select case
    when coalesce(trim(client_number), '') = '' or project_sequence is null or project_sequence < 1 then null
    else trim(client_number) || '/' || lpad(project_sequence::text, 4, '0')
  end
$$;

create or replace function public.option_code_from_number(option_number integer)
returns text
language plpgsql
immutable
as $$
declare
  value integer := greatest(coalesce(option_number, 1), 1);
  result text := '';
  remainder integer;
begin
  while value > 0 loop
    remainder := (value - 1) % 26;
    result := chr(65 + remainder) || result;
    value := (value - 1) / 26;
  end loop;

  return result;
end;
$$;

create or replace function public.format_quotation_document_number(
  project_number text,
  option_no integer,
  revision_no integer
)
returns text
language sql
immutable
as $$
  select case
    when coalesce(trim(project_number), '') = '' then null
    else trim(project_number)
      || case
        when greatest(coalesce(option_no, 1), 1) > 1
          then '-OPT-' || public.option_code_from_number(greatest(coalesce(option_no, 1), 1) - 1)
        else ''
      end
      || case
        when greatest(coalesce(revision_no, 0), 0) > 0
          then '-R' || lpad(greatest(coalesce(revision_no, 0), 0)::text, 2, '0')
        else ''
      end
  end
$$;

create or replace function public.assign_client_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(new.client_number), '') = '' then
    new.client_number := nextval('public.client_number_seq')::text;
  end if;

  return new;
end;
$$;

create or replace function public.assign_project_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_client_number text;
  next_sequence integer;
begin
  if coalesce(trim(new.project_number), '') <> '' and new.project_sequence is not null then
    return new;
  end if;

  if new.client_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.client_id::text));

  select client_number
  into resolved_client_number
  from public.clients
  where id = new.client_id;

  if coalesce(trim(resolved_client_number), '') = '' then
    raise exception 'Client number is missing for client %', new.client_id;
  end if;

  if new.project_sequence is null or new.project_sequence < 1 then
    select coalesce(max(project_sequence), 0) + 1
    into next_sequence
    from public.projects
    where client_id = new.client_id
      and id is distinct from new.id;

    new.project_sequence := next_sequence;
  end if;

  new.project_number := public.format_project_number(resolved_client_number, new.project_sequence);
  return new;
end;
$$;

create or replace function public.assign_quotation_document_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_project_number text;
  generated_document_number text;
begin
  if new.project_id is null then
    return new;
  end if;

  select project_number
  into resolved_project_number
  from public.projects
  where id = new.project_id;

  generated_document_number := public.format_quotation_document_number(
    resolved_project_number,
    greatest(coalesce(new.option_no, 1), 1),
    greatest(coalesce(new.revision_no, 0), 0)
  );

  if tg_op = 'UPDATE'
    and old.quotation_no is not null
    and old.quotation_no is distinct from generated_document_number
    and coalesce(new.legacy_reference, '') = ''
  then
    new.legacy_reference := coalesce(old.legacy_reference, old.quotation_no);
  end if;

  new.option_no := greatest(coalesce(new.option_no, 1), 1);
  new.revision_no := greatest(coalesce(new.revision_no, 0), 0);
  new.quotation_no := generated_document_number;

  return new;
end;
$$;

drop trigger if exists clients_assign_client_number on public.clients;

create trigger clients_assign_client_number
before insert on public.clients
for each row
execute function public.assign_client_number();

drop trigger if exists projects_assign_project_number on public.projects;

create trigger projects_assign_project_number
before insert or update of client_id, project_sequence, project_number on public.projects
for each row
execute function public.assign_project_number();

drop trigger if exists quotations_assign_document_number on public.quotations;

create trigger quotations_assign_document_number
before insert or update of project_id, option_no, revision_no, quotation_no on public.quotations
for each row
execute function public.assign_quotation_document_number();

do $$
declare
  max_client_number bigint;
begin
  select max(client_number::bigint)
  into max_client_number
  from public.clients
  where client_number ~ '^\d+$';

  perform setval('public.client_number_seq', greatest(coalesce(max_client_number, 99), 99), true);

  update public.clients
  set client_number = nextval('public.client_number_seq')::text
  where coalesce(trim(client_number), '') = '';
end $$;

with numbered_projects as (
  select
    p.id,
    c.client_number,
    (
      row_number() over (
        partition by p.client_id
        order by p.created_at, p.id
      )
    )::integer as generated_sequence
  from public.projects p
  join public.clients c on c.id = p.client_id
  where p.project_number is null
)
update public.projects p
set
  project_sequence = numbered_projects.generated_sequence,
  project_number = public.format_project_number(
    numbered_projects.client_number,
    numbered_projects.generated_sequence
  )
from numbered_projects
where p.id = numbered_projects.id;

update public.projects
set project_sequence = substring(project_number from '/(\d{4})$')::integer
where project_sequence is null
  and project_number ~ '^[0-9]+/[0-9]{4}$';

update public.quotations
set legacy_reference = quotation_no
where legacy_reference is null
  and quotation_no is not null;

update public.quotations
set quotation_no = public.format_quotation_document_number(
  projects.project_number,
  greatest(coalesce(public.quotations.option_no, 1), 1),
  greatest(coalesce(public.quotations.revision_no, 0), 0)
)
from public.projects
where projects.id = public.quotations.project_id
  and projects.project_number is not null;

create unique index if not exists clients_client_number_unique_idx
on public.clients (client_number)
where client_number is not null;

create unique index if not exists projects_project_number_unique_idx
on public.projects (project_number)
where project_number is not null;
