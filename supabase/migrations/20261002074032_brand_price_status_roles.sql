begin;

-- Role lookups already use trusted profiles. These wrappers need no definer
-- privileges and intentionally leave manual Product edit/read policies alone.
create or replace function public.current_user_can_review_brand_prices()
returns boolean language sql stable security invoker set search_path = ''
as $$
  select coalesce(public.current_account_status() = 'active' and
    public.current_user_role() in ('system_owner', 'admin_manager', 'procurement_manager', 'designer'), false);
$$;

create or replace function public.current_user_can_approve_brand_prices()
returns boolean language sql stable security invoker set search_path = ''
as $$
  select coalesce(public.current_account_status() = 'active' and
    public.current_user_role() in ('system_owner', 'admin_manager', 'procurement_manager'), false);
$$;

revoke all on function public.current_user_can_review_brand_prices() from public;
revoke all on function public.current_user_can_approve_brand_prices() from public;
grant execute on function public.current_user_can_review_brand_prices() to authenticated;
grant execute on function public.current_user_can_approve_brand_prices() to authenticated;

drop policy if exists brand_price_list_updates_insert_managers on public.brand_price_list_updates;
create policy brand_price_list_updates_insert_managers on public.brand_price_list_updates
for insert to authenticated with check (public.current_user_can_review_brand_prices());

drop policy if exists brand_price_list_updates_update_managers on public.brand_price_list_updates;
create policy brand_price_list_updates_update_managers on public.brand_price_list_updates
for update to authenticated using (public.current_user_can_review_brand_prices())
with check (public.current_user_can_review_brand_prices());

commit;
