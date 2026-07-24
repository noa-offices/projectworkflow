create or replace function public.current_user_can_manage_company_settings()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_user_role() in ('system_owner', 'admin_manager', 'procurement_manager')
    and public.current_account_status() = 'active',
    false
  );
$$;

grant execute on function public.current_user_can_manage_company_settings() to authenticated;

drop policy if exists company_settings_insert_managers on public.company_settings;

create policy company_settings_insert_managers
on public.company_settings
for insert
to authenticated
with check (public.current_user_can_manage_company_settings());

drop policy if exists company_settings_update_managers on public.company_settings;

create policy company_settings_update_managers
on public.company_settings
for update
to authenticated
using (public.current_user_can_manage_company_settings())
with check (public.current_user_can_manage_company_settings());
