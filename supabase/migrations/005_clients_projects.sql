create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_account_status() = 'active', false);
$$;

create or replace function public.current_user_can_manage_records()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_user_role() in (
      'system_owner',
      'admin_manager',
      'sales_designer'
    )
    and public.current_account_status() = 'active',
    false
  );
$$;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  client_code text,
  contact_person text,
  email text,
  phone text,
  website text,
  address text,
  city text,
  country text not null default 'UAE',
  trn text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  project_name text not null,
  project_code text,
  location text,
  consultant text,
  contractor text,
  attention_to text,
  project_status text not null default 'active',
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_project_status_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
    add constraint projects_project_status_check
    check (project_status in ('active', 'on_hold', 'completed', 'cancelled'));
  end if;
end $$;

create index if not exists clients_company_name_idx
on public.clients (company_name);

create index if not exists clients_client_code_idx
on public.clients (client_code);

create index if not exists projects_client_id_idx
on public.projects (client_id);

create index if not exists projects_project_name_idx
on public.projects (project_name);

create index if not exists projects_project_code_idx
on public.projects (project_code);

create unique index if not exists clients_active_client_code_unique_idx
on public.clients (lower(client_code))
where client_code is not null
  and is_active = true;

create unique index if not exists projects_project_code_unique_idx
on public.projects (lower(project_code))
where project_code is not null;

drop trigger if exists clients_set_updated_at on public.clients;

create trigger clients_set_updated_at
before update on public.clients
for each row
execute function public.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;

create trigger projects_set_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

alter table public.clients enable row level security;
alter table public.projects enable row level security;

drop policy if exists clients_select_active on public.clients;

create policy clients_select_active
on public.clients
for select
to authenticated
using (
  is_active = true
  and public.current_user_is_active()
);

drop policy if exists clients_select_managers on public.clients;

create policy clients_select_managers
on public.clients
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists clients_insert_record_managers on public.clients;

create policy clients_insert_record_managers
on public.clients
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists clients_update_record_managers on public.clients;

create policy clients_update_record_managers
on public.clients
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

drop policy if exists projects_select_active on public.projects;

create policy projects_select_active
on public.projects
for select
to authenticated
using (
  is_active = true
  and public.current_user_is_active()
);

drop policy if exists projects_select_managers on public.projects;

create policy projects_select_managers
on public.projects
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists projects_insert_record_managers on public.projects;

create policy projects_insert_record_managers
on public.projects
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists projects_update_record_managers on public.projects;

create policy projects_update_record_managers
on public.projects
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.projects to authenticated;
grant execute on function public.current_user_is_active() to authenticated;
grant execute on function public.current_user_can_manage_records() to authenticated;
