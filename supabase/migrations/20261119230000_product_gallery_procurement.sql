-- Product Gallery: the procurement manager gets everything sales staff have (view, edit name/tags/specification, remove).
-- Merging stays owner/admin only. Only the two role helper functions change. NOT applied automatically.
create or replace function public.product_gallery_can_view()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_is_active()
    and public.current_user_role() in ('system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer'), false);
$$;

create or replace function public.product_gallery_is_editor()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_is_active()
    and public.current_user_role() in ('system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer'), false);
$$;

revoke all on function public.product_gallery_can_view() from public, anon;
revoke all on function public.product_gallery_is_editor() from public, anon;
grant execute on function public.product_gallery_can_view() to authenticated;
grant execute on function public.product_gallery_is_editor() to authenticated;
