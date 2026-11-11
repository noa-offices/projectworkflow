-- Security: the two record/procurement helper functions now also require an ACTIVE account.
-- Before this, a disabled or pending user with an old session could still pass the 96 policies that rely on them.
create or replace function public.current_user_can_manage_records()
returns boolean language sql stable security definer set search_path to 'public' as $fn$
  SELECT role IN ('system_owner', 'admin_manager', 'procurement_manager', 'sales_designer', 'designer')
    AND account_status = 'active'
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
$fn$;

create or replace function public.current_user_can_access_procurement()
returns boolean language sql stable security definer set search_path to 'public' as $fn$
  SELECT role IN ('system_owner', 'admin_manager', 'procurement_manager')
    AND account_status = 'active'
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
$fn$;
