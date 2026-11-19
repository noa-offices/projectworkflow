-- Product Gallery (G-U2): update offers also appear when the SAME quotation is edited and its status is confirmed again, and editors get a
-- "Check for updates" button. NOT applied automatically.
--  * product_gallery_record_core(quotation, offers_only): the old record logic; offers are now proposed BEFORE the "already counted by this quotation" skip.
--  * product_gallery_record(quotation): unchanged behaviour for the status trigger (calls core with offers_only = false).
--  * product_gallery_check_updates(): editors only. Re-reads the latest saved quotations of the saved items and offers updates (never counts, never adds items).
create or replace function public.product_gallery_record_core(p_quotation_id uuid, p_offers_only boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_clean jsonb; v_key text; v_rows integer; v_counted integer := 0; v_img text; v_old record; v_offers integer := 0;
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

    -- The saved configuration is quoted again (by another quotation, or the same one confirmed again) with a different specification or picture:
    -- keep the saved one and offer an update.
    if v_old.id is not null then
      if r.spec is not null and v_old.specification is not null and r.spec is distinct from v_old.specification then
        perform public.product_gallery_propose(v_old.id, 'specification', r.spec); v_offers := v_offers + 1;
      end if;
      if v_img is not null and v_old.selected_image is not null and v_img is distinct from v_old.selected_image then
        perform public.product_gallery_propose(v_old.id, 'picture', v_img); v_offers := v_offers + 1;
      end if;
    end if;
    continue when p_offers_only;

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
  if p_offers_only then return v_offers; end if;
  return v_counted;
end $$;

create or replace function public.product_gallery_record(p_quotation_id uuid)
returns integer language sql security definer set search_path = '' as $$
  select public.product_gallery_record_core(p_quotation_id, false);
$$;

create or replace function public.product_gallery_check_updates()
returns integer language plpgsql security definer set search_path = '' as $$
declare q uuid; v_total integer := 0;
begin
  if not public.product_gallery_is_editor() then raise exception 'Not allowed.'; end if;
  for q in
    select s.quotation_id from public.product_gallery_sources s
      join public.quotations qq on qq.id = s.quotation_id
     group by s.quotation_id, qq.updated_at order by qq.updated_at desc limit 100
  loop
    v_total := v_total + public.product_gallery_record_core(q, true);
  end loop;
  return v_total;
end $$;

revoke all on function public.product_gallery_record_core(uuid, boolean) from public, anon, authenticated;
revoke all on function public.product_gallery_record(uuid) from public, anon, authenticated;
revoke all on function public.product_gallery_check_updates() from public, anon;
grant execute on function public.product_gallery_check_updates() to authenticated;
