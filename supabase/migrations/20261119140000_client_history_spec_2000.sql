-- Client history (stage A, update 1): keep up to 2,000 characters of the specification (was 300), so a re-added custom item keeps its full text.
-- The table is still empty, so this is safe. NOT applied automatically.
alter table public.client_quote_history drop constraint if exists client_quote_history_spec_short_check;
alter table public.client_quote_history add constraint client_quote_history_spec_short_check check (spec_short is null or char_length(spec_short) <= 2000);

-- D. Record one quotation into the history. Internal: only the trigger calls it. Returns how many items were skipped because the client's history is full (300).
create or replace function public.client_quote_history_record(p_quotation_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare q record; r record; v_skipped integer := 0; v_count integer; v_entry jsonb; v_rows integer;
begin
  select id, client_id, quotation_no into q from public.quotations where id = p_quotation_id and is_active;
  if not found or q.client_id is null then return 0; end if;

  for r in
    with base as (
      select i.sort_order, i.net_price, i.qty, i.currency, i.unit_label, i.source_template_id,
             btrim(i.item_name_snapshot) as item_name, nullif(btrim(i.brand_name_snapshot), '') as brand,
             nullif(btrim(i.item_code_snapshot), '') as item_code, nullif(btrim(left(i.specification_snapshot, 2000)), '') as spec_short,
             i.selected_options_snapshot,
             case when jsonb_typeof(i.source_component_data->'configuration_recipe') = 'object'
                   and octet_length((i.source_component_data->'configuration_recipe')::text) <= 65536
                   and not public.my_collection_json_forbidden_key(i.source_component_data->'configuration_recipe')
                  then i.source_component_data->'configuration_recipe' end as recipe,
             case when i.item_type = 'custom' or i.source_template_id is null then 'custom' else 'product' end as base_kind,
             case when i.proposed_image_url_snapshot like 'quote-images:quotation-items/%' and char_length(i.proposed_image_url_snapshot) <= 400
                  then i.proposed_image_url_snapshot end as picture
        from public.quotation_items i
       where i.quotation_id = q.id and i.is_active and i.item_type in ('product', 'custom')
         and coalesce(i.line_style, '') not in ('heading', 'note', 'no_quote')
         and not i.is_rate_only and i.include_in_total and i.parent_item_id is null
         and i.net_price > 0 and char_length(btrim(coalesce(i.item_name_snapshot, ''))) > 0
    ), typed as (
      select b.*, case when b.base_kind = 'custom' then 'custom' when b.recipe is not null then 'configured' else 'library' end as kind from base b
    ), keyed as (
      select t.*, public.client_quote_history_identity(t.kind, t.source_template_id, t.recipe, t.selected_options_snapshot, t.brand, t.item_name, t.item_code) as identity_key from typed t
    )
    select distinct on (identity_key) * from keyed order by identity_key, sort_order desc
  loop
    v_entry := jsonb_build_object('price', r.net_price, 'currency', r.currency, 'qty', r.qty, 'at', now(), 'quotation_id', q.id, 'quotation_no', q.quotation_no);

    update public.client_quote_history h set
        kind = r.kind, template_id = r.source_template_id, item_name = left(r.item_name, 300), brand = left(r.brand, 120),
        item_code = left(r.item_code, 80), spec_short = r.spec_short, unit_label = left(r.unit_label, 30), qty = r.qty,
        currency = r.currency, last_unit_price = round(r.net_price, 2),
        last_prices = (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from (
            select e, ord from jsonb_array_elements(v_entry || case when h.last_prices->0->>'quotation_id' = q.id::text then h.last_prices - 0 else h.last_prices end) with ordinality t(e, ord)
            order by ord limit 5) s),
        line_recipe = case when r.kind = 'configured' then r.recipe end,
        picture_ref = case when r.kind = 'custom' then r.picture end,
        last_quotation_id = q.id, last_quotation_no = q.quotation_no, quoted_at = now()
      where h.client_id = q.client_id and h.identity_key = r.identity_key;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
      select count(*) into v_count from public.client_quote_history where client_id = q.client_id;
      if v_count >= 300 then
        v_skipped := v_skipped + 1;
      else
        insert into public.client_quote_history (client_id, identity_key, kind, template_id, item_name, brand, item_code, spec_short, unit_label, qty,
            currency, last_unit_price, last_prices, line_recipe, picture_ref, last_quotation_id, last_quotation_no)
        values (q.client_id, r.identity_key, r.kind, r.source_template_id, left(r.item_name, 300), left(r.brand, 120), left(r.item_code, 80), r.spec_short,
            left(r.unit_label, 30), r.qty, r.currency, round(r.net_price, 2), jsonb_build_array(v_entry),
            case when r.kind = 'configured' then r.recipe end, case when r.kind = 'custom' then r.picture end, q.id, q.quotation_no)
        on conflict (client_id, identity_key) do nothing;
      end if;
    end if;
  end loop;
  return v_skipped;
end $$;
