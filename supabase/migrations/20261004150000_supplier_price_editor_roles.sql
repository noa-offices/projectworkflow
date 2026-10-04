begin;

-- Supplier / Brand price review: system_owner, admin_manager, procurement_manager, sales_coordinator and designer
-- can review and approve. Every other role stays read-only. Same signatures, grants and invoker security as before.
-- These helpers are used only by Brand price-list policies and the Supplier price review / completion functions.
create or replace function public.current_user_can_review_brand_prices()
returns boolean language sql stable security invoker set search_path = ''
as $$
  select coalesce(public.current_account_status() = 'active' and
    public.current_user_role() in ('system_owner', 'admin_manager', 'procurement_manager', 'sales_coordinator', 'designer'), false);
$$;

create or replace function public.current_user_can_approve_brand_prices()
returns boolean language sql stable security invoker set search_path = ''
as $$
  select coalesce(public.current_account_status() = 'active' and
    public.current_user_role() in ('system_owner', 'admin_manager', 'procurement_manager', 'sales_coordinator', 'designer'), false);
$$;

revoke all on function public.current_user_can_review_brand_prices() from public;
revoke all on function public.current_user_can_approve_brand_prices() from public;
grant execute on function public.current_user_can_review_brand_prices() to authenticated;
grant execute on function public.current_user_can_approve_brand_prices() to authenticated;

commit;
