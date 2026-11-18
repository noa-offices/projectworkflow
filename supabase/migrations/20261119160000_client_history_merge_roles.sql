-- Client history (update 3): the roles that may MERGE client history now match the roles that may merge clients in the app
-- (system_owner, admin_manager, sales_designer, sales_coordinator). Before, a sales_coordinator could merge two clients but their history stayed behind.
-- Only the permission line changes; the merge logic is identical. NOT applied automatically.
create or replace function public.client_quote_history_merge_clients(p_from uuid, p_to uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.current_user_is_active()
      and public.current_user_role() in ('system_owner', 'admin_manager', 'sales_designer', 'sales_coordinator'), false) then
    raise exception 'Not allowed.';
  end if;
  if p_from is null or p_to is null or p_from = p_to then return; end if;
  delete from public.client_quote_history f using public.client_quote_history t
   where f.client_id = p_from and t.client_id = p_to and t.identity_key = f.identity_key and t.quoted_at >= f.quoted_at;
  delete from public.client_quote_history t
   where t.client_id = p_to and exists (select 1 from public.client_quote_history f where f.client_id = p_from and f.identity_key = t.identity_key);
  update public.client_quote_history set client_id = p_to where client_id = p_from;
end $$;
