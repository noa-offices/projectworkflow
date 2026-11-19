-- Product Gallery (G-R1 + G-U1): take a removed item BACK, and offer an UPDATE when the same configuration is quoted again with a different
-- specification or picture. NOT applied automatically.
--  * Removing now keeps a full snapshot of the item, so it can be restored (Restore needs an editor). Older removals (key only) can only be
--    "allowed again": the next quotation of that configuration adds it again.
--  * product_gallery_updates holds open update offers (specification / picture) and ignored ones. An ignored offer stays ignored until a
--    DIFFERENT value is offered. 'configuration' rows only remember an ignored "saved choices changed in the product" notice (the app writes them).
--  * Only editors (product_gallery_is_editor) can read the offers, apply, ignore, list removed items or restore.
alter table public.product_gallery_removed add column if not exists snapshot jsonb;

create table if not exists public.product_gallery_updates (
  item_id uuid not null references public.product_gallery_items (id) on delete cascade,
  kind text not null check (kind in ('specification', 'picture', 'configuration')),
  proposed_value text check (proposed_value is null or char_length(proposed_value) <= 2000),
  status text not null default 'open' check (status in ('open', 'ignored')),
  proposed_at timestamptz not null default now(),
  primary key (item_id, kind)
);
alter table public.product_gallery_updates enable row level security;
revoke all on public.product_gallery_updates from public, anon, authenticated;
grant select on public.product_gallery_updates to authenticated;
drop policy if exists product_gallery_updates_select on public.product_gallery_updates;
create policy product_gallery_updates_select on public.product_gallery_updates for select to authenticated
  using (public.product_gallery_is_editor());

-- Internal: create or refresh one offer (never reopens an offer with the same value that was ignored).
create or replace function public.product_gallery_propose(p_item uuid, p_kind text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.product_gallery_updates (item_id, kind, proposed_value, status)
  values (p_item, p_kind, left(p_value, 2000), 'open')
  on conflict (item_id, kind) do update
    set proposed_value = excluded.proposed_value,
        status = case when public.product_gallery_updates.proposed_value = excluded.proposed_value then public.product_gallery_updates.status else 'open' end,
        proposed_at = case when public.product_gallery_updates.proposed_value = excluded.proposed_value then public.product_gallery_updates.proposed_at else now() end;
end $$;
revoke all on function public.product_gallery_propose(uuid, text, text) from public, anon, authenticated;

create or replace function public.product_gallery_record(p_quotation_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_clean jsonb; v_key text; v_rows integer; v_counted integer := 0; v_img text; v_old record;
begin
  if not exists (select 1 from public.quotations where id = p_quotation_id and is_active and status not in ('draft', 'cancelled', 'archived')) then return 0; end if;
  for r in
    select i.source_template_id as template_id, i.source_component_data->'configuration_recipe'->'recipe' as recipe,
           public.product_gallery_clean_specification(i.specification_snapshot) as spec
      from public.quotation_items i
     where i.quotation_id = p_quotation_id and i.is_active and i.item_type = 'product' and i.source_template_id is not null
       and i.parent_item_id is null and i.include_in_total and not i.is_rate_only
       and coalesce(i.line_style, '') not in ('heading', 'note', 'no_quote')
       and jsonb_typeof(i.source_component_data->'configuration_recipe'->'recipe') = 'object'
  loop
    v_clean := public.product_gallery_clean_recipe(r.recipe, r.template_id);
    continue when v_clean is null;
    -- only an active product with an active lifecycle can be in the gallery
    perform 1 from public.product_templates t where t.id = r.template_id and t.is_active and t.lifecycle_status = 'active';
    continue when not found;
    v_key := 'g:' || r.template_id::text || ':' || encode(sha256(convert_to(v_clean::text, 'utf8')), 'hex');
    -- a configuration the team has REMOVED from the gallery stays removed
    continue when exists (select 1 from public.product_gallery_removed x where x.identity_key = v_key);

    v_img := public.product_gallery_clean_image(r.recipe->>'selected_image');
    select g.id, g.specification, g.selected_image into v_old from public.product_gallery_items g where g.identity_key = v_key;

    insert into public.product_gallery_sources (quotation_id, identity_key) values (p_quotation_id, v_key) on conflict do nothing;
    get diagnostics v_rows = row_count;
    continue when v_rows = 0;   -- this quotation already counted this configuration

    insert into public.product_gallery_items (identity_key, template_id, brand_id, main_category_id, sub_category_id, item_name, item_code, currency, recipe, search_text, specification, selected_image)
    select v_key, t.id, t.brand_id, t.main_category_id, t.sub_category_id,
           left(coalesce(nullif(btrim(t.template_name), ''), nullif(btrim(t.internal_selection_name), ''), 'Product'), 300),
           left(nullif(btrim(t.item_code), ''), 80), left(nullif(btrim(t.currency), ''), 8), v_clean,
           left(btrim(regexp_replace(lower(coalesce(t.template_name, '') || ' ' || coalesce(t.internal_selection_name, '') || ' ' || coalesce(t.item_code, '')), '[^a-z0-9]+', ' ', 'g')), 800),
           r.spec,
           public.product_gallery_clean_image(r.recipe->>'selected_image')
      from public.product_templates t
     where t.id = r.template_id and t.is_active and t.lifecycle_status = 'active'
    on conflict (identity_key) do update set
      quoted_count = public.product_gallery_items.quoted_count + 1,
      last_quoted_at = now(),
      brand_id = excluded.brand_id, main_category_id = excluded.main_category_id, sub_category_id = excluded.sub_category_id,
      item_name = excluded.item_name, item_code = excluded.item_code, currency = excluded.currency, search_text = excluded.search_text,
      -- the specification is copied only once: a later quote never overwrites it (an empty one may be filled)
      specification = coalesce(public.product_gallery_items.specification, excluded.specification),
      -- the picture chosen in the quotation builder is copied once, like the specification
      selected_image = coalesce(public.product_gallery_items.selected_image, excluded.selected_image);
    -- The same configuration was quoted again with a different specification or picture: keep the saved one and offer an update.
    if v_old.id is not null then
      if r.spec is not null and v_old.specification is not null and r.spec is distinct from v_old.specification then
        perform public.product_gallery_propose(v_old.id, 'specification', r.spec);
      end if;
      if v_img is not null and v_old.selected_image is not null and v_img is distinct from v_old.selected_image then
        perform public.product_gallery_propose(v_old.id, 'picture', v_img);
      end if;
    end if;
    v_counted := v_counted + 1;
  end loop;
  return v_counted;
end $$;

create or replace function public.product_gallery_remove(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if not public.product_gallery_is_editor() then raise exception 'Not allowed.'; end if;
  select identity_key into v_key from public.product_gallery_items where id = p_id for update;
  if v_key is null then return false; end if;
  insert into public.product_gallery_removed (identity_key, removed_by) values (v_key, auth.uid()) on conflict do nothing;
  delete from public.product_gallery_sources where identity_key = v_key;
  delete from public.product_gallery_items where id = p_id;
  return true;
end $$;


-- Apply an open offer to the item (specification or picture).
create or replace function public.product_gallery_update_apply(p_item uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if not public.product_gallery_is_editor() then raise exception 'Not allowed.'; end if;
  if p_kind not in ('specification', 'picture') then return false; end if;
  select proposed_value into v from public.product_gallery_updates where item_id = p_item and kind = p_kind and status = 'open';
  if not found then return false; end if;
  if p_kind = 'specification' then
    update public.product_gallery_items set specification = public.product_gallery_clean_specification(v) where id = p_item;
  else
    update public.product_gallery_items set selected_image = public.product_gallery_clean_image(v) where id = p_item;
  end if;
  delete from public.product_gallery_updates where item_id = p_item and kind = p_kind;
  return true;
end $$;

-- Ignore an offer. For specification / picture the open offer is kept as "ignored". For 'configuration' the app passes a short fingerprint
-- of the notice; the notice stays ignored until the fingerprint changes.
create or replace function public.product_gallery_update_ignore(p_item uuid, p_kind text, p_value text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.product_gallery_is_editor() then raise exception 'Not allowed.'; end if;
  if p_kind not in ('specification', 'picture', 'configuration') then return false; end if;
  if not exists (select 1 from public.product_gallery_items where id = p_item) then return false; end if;
  if p_kind = 'configuration' then
    insert into public.product_gallery_updates (item_id, kind, proposed_value, status)
    values (p_item, 'configuration', left(coalesce(p_value, ''), 200), 'ignored')
    on conflict (item_id, kind) do update set proposed_value = excluded.proposed_value, status = 'ignored', proposed_at = now();
    return true;
  end if;
  update public.product_gallery_updates set status = 'ignored' where item_id = p_item and kind = p_kind and status = 'open';
  return found;
end $$;

-- Remove now keeps a snapshot (and keeps the source rows) so the item can come back.
create or replace function public.product_gallery_remove(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_row public.product_gallery_items;
begin
  if not public.product_gallery_is_editor() then raise exception 'Not allowed.'; end if;
  select * into v_row from public.product_gallery_items where id = p_id for update;
  if v_row.id is null then return false; end if;
  insert into public.product_gallery_removed (identity_key, removed_by, snapshot) values (v_row.identity_key, auth.uid(), to_jsonb(v_row))
    on conflict (identity_key) do update set snapshot = excluded.snapshot, removed_at = now(), removed_by = excluded.removed_by;
  delete from public.product_gallery_items where id = p_id;
  return true;
end $$;

-- Removed items, newest first (editors only).
create or replace function public.product_gallery_removed_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.product_gallery_is_editor() then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'identity_key', r.identity_key,
      'removed_at', r.removed_at,
      'template_id', coalesce(r.snapshot->>'template_id', nullif(split_part(r.identity_key, ':', 2), '')),
      'item_name', r.snapshot->>'item_name',
      'display_name', r.snapshot->>'display_name',
      'quoted_count', (r.snapshot->>'quoted_count')::integer,
      'has_snapshot', r.snapshot is not null) order by r.removed_at desc)
    from public.product_gallery_removed r), '[]'::jsonb);
end $$;

-- Take an item back. With a snapshot the item returns exactly as it was; an older removal (key only) is just allowed again.
create or replace function public.product_gallery_restore(p_key text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_snap jsonb; v_found boolean;
begin
  if not public.product_gallery_is_editor() then raise exception 'Not allowed.'; end if;
  select snapshot, true into v_snap, v_found from public.product_gallery_removed where identity_key = p_key;
  if v_found is null then return 'not_found'; end if;
  delete from public.product_gallery_removed where identity_key = p_key;
  if v_snap is null then return 'allowed_again'; end if;
  insert into public.product_gallery_items select (jsonb_populate_record(null::public.product_gallery_items, v_snap)).* on conflict (identity_key) do nothing;
  return 'restored';
end $$;

revoke all on function public.product_gallery_record(uuid) from public, anon, authenticated;
revoke all on function public.product_gallery_update_apply(uuid, text) from public, anon;
revoke all on function public.product_gallery_update_ignore(uuid, text, text) from public, anon;
revoke all on function public.product_gallery_remove(uuid) from public, anon;
revoke all on function public.product_gallery_removed_list() from public, anon;
revoke all on function public.product_gallery_restore(text) from public, anon;
grant execute on function public.product_gallery_update_apply(uuid, text) to authenticated;
grant execute on function public.product_gallery_update_ignore(uuid, text, text) to authenticated;
grant execute on function public.product_gallery_remove(uuid) to authenticated;
grant execute on function public.product_gallery_removed_list() to authenticated;
grant execute on function public.product_gallery_restore(text) to authenticated;
