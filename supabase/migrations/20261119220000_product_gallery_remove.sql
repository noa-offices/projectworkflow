-- Product Gallery (G-S3): REMOVE an item from the gallery for good (replaces Hide).
-- A removed configuration is remembered in product_gallery_removed (nobody can read it through the app), so the automatic growth
-- does not bring it back the next time it is quoted. Editors (product_gallery_is_editor) can remove. Items that were hidden are removed too.
-- NOT applied automatically.
create table if not exists public.product_gallery_removed (
  identity_key text primary key,
  removed_at timestamptz not null default now(),
  removed_by uuid
);
alter table public.product_gallery_removed enable row level security;
revoke all on public.product_gallery_removed from public, anon, authenticated;

create or replace function public.product_gallery_record(p_quotation_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_clean jsonb; v_key text; v_rows integer; v_counted integer := 0;
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

revoke all on function public.product_gallery_record(uuid) from public, anon, authenticated;
revoke all on function public.product_gallery_remove(uuid) from public, anon;
grant execute on function public.product_gallery_remove(uuid) to authenticated;

-- One-off: items that were hidden become removed.
insert into public.product_gallery_removed (identity_key)
  select identity_key from public.product_gallery_items where is_hidden on conflict do nothing;
delete from public.product_gallery_sources where identity_key in (select identity_key from public.product_gallery_removed);
delete from public.product_gallery_items where is_hidden;
