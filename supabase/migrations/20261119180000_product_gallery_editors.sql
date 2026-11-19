-- Product Gallery (update 2): sales users may EDIT a gallery item (display name, tags) and HIDE/UNHIDE it. Merging stays owner/admin only.
-- New helper product_gallery_is_editor() names the allowed roles; update_details and set_hidden use it; editors can also see hidden items (to unhide).
-- NOT applied automatically.
create or replace function public.product_gallery_is_editor()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_is_active()
    and public.current_user_role() in ('system_owner','admin_manager','sales_designer','sales_coordinator','designer'), false);
$$;

create or replace function public.product_gallery_update_details(p_id uuid, p_display_name text, p_tags text[])
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer; v_tags text[]; v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if not public.product_gallery_is_editor() then raise exception 'Not allowed.'; end if;
  if v_name is not null and char_length(v_name) > 120 then raise exception 'Name is too long.'; end if;
  select coalesce(array_agg(distinct t order by t), '{}') into v_tags
    from (select left(lower(btrim(x)), 30) as t from unnest(coalesce(p_tags, '{}')) as x) q where t <> '';
  if cardinality(v_tags) > 20 then raise exception 'Too many tags.'; end if;
  update public.product_gallery_items set display_name = v_name, tags = v_tags where id = p_id;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.product_gallery_is_editor() from public, anon;
revoke all on function public.product_gallery_update_details(uuid, text, text[]) from public, anon;
grant execute on function public.product_gallery_is_editor() to authenticated;
grant execute on function public.product_gallery_update_details(uuid, text, text[]) to authenticated;

create or replace function public.product_gallery_set_hidden(p_id uuid, p_hidden boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.product_gallery_is_editor() then raise exception 'Not allowed.'; end if;
  update public.product_gallery_items set is_hidden = coalesce(p_hidden, false) where id = p_id;
  get diagnostics n = row_count;
  return n > 0;
end $$;

drop policy if exists product_gallery_items_select on public.product_gallery_items;
create policy product_gallery_items_select on public.product_gallery_items for select to authenticated
  using (public.product_gallery_can_view() and (not is_hidden or public.product_gallery_is_editor()));

revoke all on function public.product_gallery_set_hidden(uuid, boolean) from public, anon;
grant execute on function public.product_gallery_set_hidden(uuid, boolean) to authenticated;
