-- Product Gallery (G-S2): remember the PICTURE chosen in the quotation builder.
-- selected_image holds the template picture path the user picked when the configuration was first quoted (copied once, never overwritten).
-- It is only a picture path of the product (no price, no client data). The app also checks at read time that it is still one of the
-- template's own pictures. Existing items are filled in once from the quotations that created them. NOT applied automatically.
alter table public.product_gallery_items add column if not exists selected_image text;
alter table public.product_gallery_items drop constraint if exists product_gallery_items_selected_image_check;
alter table public.product_gallery_items
  add constraint product_gallery_items_selected_image_check check (selected_image is null or char_length(selected_image) <= 500);

create or replace function public.product_gallery_clean_image(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when nullif(btrim(coalesce(p, '')), '') is null then null
    when char_length(btrim(p)) > 500 then null
    when btrim(p) ~* '^(data|javascript|blob):' then null
    else btrim(p) end $$;

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

revoke all on function public.product_gallery_clean_image(text) from public, anon, authenticated;
revoke all on function public.product_gallery_record(uuid) from public, anon, authenticated;

-- One-off fill of existing items (empty picture only; empty specification too) from the quotation line that made each item.
update public.product_gallery_items g
   set selected_image = coalesce(g.selected_image, x.img),
       specification = coalesce(g.specification, x.spec)
  from (
    select distinct on (s.identity_key) s.identity_key,
           public.product_gallery_clean_image(i.source_component_data->'configuration_recipe'->'recipe'->>'selected_image') as img,
           public.product_gallery_clean_specification(i.specification_snapshot) as spec
      from public.product_gallery_sources s
      join public.quotation_items i on i.quotation_id = s.quotation_id and i.is_active and i.item_type = 'product'
       and i.source_template_id is not null
       and jsonb_typeof(i.source_component_data->'configuration_recipe'->'recipe') = 'object'
     where public.product_gallery_clean_recipe(i.source_component_data->'configuration_recipe'->'recipe', i.source_template_id) is not null
       and s.identity_key = 'g:' || i.source_template_id::text || ':' ||
           encode(sha256(convert_to(public.product_gallery_clean_recipe(i.source_component_data->'configuration_recipe'->'recipe', i.source_template_id)::text, 'utf8')), 'hex')
     order by s.identity_key, i.id
  ) x
 where g.identity_key = x.identity_key and (g.selected_image is null or g.specification is null);
