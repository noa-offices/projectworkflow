-- Product Gallery (G-S1): a gallery item keeps a generic SPECIFICATION text that editors can correct.
-- The text is copied ONCE from the quotation line's specification_snapshot when the configuration is first quoted (never overwritten by later
-- quotes; an empty one can be filled later). Text that looks like a price or a quote number is not copied. Editors (product_gallery_is_editor)
-- can change it through product_gallery_update_specification. Existing items keep an empty specification until quoted again or edited.
-- NOT applied automatically.
alter table public.product_gallery_items
  add column if not exists specification text;
alter table public.product_gallery_items drop constraint if exists product_gallery_items_specification_check;
alter table public.product_gallery_items
  add constraint product_gallery_items_specification_check check (specification is null or char_length(specification) <= 2000);

create or replace function public.product_gallery_clean_specification(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when nullif(btrim(coalesce(p, '')), '') is null then null
    when p ~* '(aed|usd|eur|dhs|\$|€)\s*[0-9]' or p ~* '[0-9]\s*(aed|usd|eur|dhs)\M' then null
    when p ~* 'qf-?[0-9]{3,}' or p ~* 'prj-?[0-9]{3,}' then null
    else left(btrim(p), 2000) end $$;

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

    insert into public.product_gallery_items (identity_key, template_id, brand_id, main_category_id, sub_category_id, item_name, item_code, currency, recipe, search_text, specification)
    select v_key, t.id, t.brand_id, t.main_category_id, t.sub_category_id,
           left(coalesce(nullif(btrim(t.template_name), ''), nullif(btrim(t.internal_selection_name), ''), 'Product'), 300),
           left(nullif(btrim(t.item_code), ''), 80), left(nullif(btrim(t.currency), ''), 8), v_clean,
           left(btrim(regexp_replace(lower(coalesce(t.template_name, '') || ' ' || coalesce(t.internal_selection_name, '') || ' ' || coalesce(t.item_code, '')), '[^a-z0-9]+', ' ', 'g')), 800),
           r.spec
      from public.product_templates t
     where t.id = r.template_id and t.is_active and t.lifecycle_status = 'active'
    on conflict (identity_key) do update set
      quoted_count = public.product_gallery_items.quoted_count + 1,
      last_quoted_at = now(),
      brand_id = excluded.brand_id, main_category_id = excluded.main_category_id, sub_category_id = excluded.sub_category_id,
      item_name = excluded.item_name, item_code = excluded.item_code, currency = excluded.currency, search_text = excluded.search_text,
      -- the specification is copied only once: a later quote never overwrites it (an empty one may be filled)
      specification = coalesce(public.product_gallery_items.specification, excluded.specification);
    v_counted := v_counted + 1;
  end loop;
  return v_counted;
end $$;

create or replace function public.product_gallery_update_specification(p_id uuid, p_specification text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer; v text := nullif(btrim(coalesce(p_specification, '')), '');
begin
  if not public.product_gallery_is_editor() then raise exception 'Not allowed.'; end if;
  if v is not null and char_length(v) > 2000 then raise exception 'Specification is too long.'; end if;
  update public.product_gallery_items set specification = v where id = p_id;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.product_gallery_clean_specification(text) from public, anon, authenticated;
revoke all on function public.product_gallery_record(uuid) from public, anon, authenticated;
revoke all on function public.product_gallery_update_specification(uuid, text) from public, anon;
grant execute on function public.product_gallery_update_specification(uuid, text) to authenticated;
