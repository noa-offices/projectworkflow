do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'user_role'
      and n.nspname = 'public'
  ) then
    create type public.user_role as enum (
      'system_owner',
      'admin_manager',
      'sales_designer',
      'viewer'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'account_status'
      and n.nspname = 'public'
  ) then
    create type public.account_status as enum (
      'pending',
      'active',
      'disabled'
    );
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role public.user_role not null default 'viewer',
  account_status public.account_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user_profile();

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
  limit 1;
$$;

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists profiles_select_system_owner on public.profiles;

create policy profiles_select_system_owner
on public.profiles
for select
to authenticated
using (public.current_user_role() = 'system_owner');

drop policy if exists profiles_update_system_owner on public.profiles;

create policy profiles_update_system_owner
on public.profiles
for update
to authenticated
using (public.current_user_role() = 'system_owner')
with check (public.current_user_role() = 'system_owner');

grant usage on schema public to anon, authenticated;
grant usage on type public.user_role to authenticated;
grant usage on type public.account_status to authenticated;
grant select on public.profiles to authenticated;
grant update on public.profiles to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.set_updated_at() to authenticated;
