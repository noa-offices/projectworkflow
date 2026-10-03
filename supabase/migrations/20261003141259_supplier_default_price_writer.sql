-- Phase 2A prerequisite: extend the existing writer without changing its signature or manual modes.
-- Function definition and existing execution grants only; no data migration.
begin;

create or replace function public.write_product_price_with_history_at_version(
  p_template_id uuid, p_expected_version bigint, p_mode text, p_payload jsonb, p_history jsonb
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare t public.product_templates; c public.product_components; result bigint;
  source text := p_history->>'source_table'; column_name text;
  price numeric; old_price numeric; price_currency text; list_id uuid; effective_date date;
begin
  if not public.current_user_is_active() then raise insufficient_privilege; end if;
  select * into t from public.product_templates where id=p_template_id for update;
  if not found or p_expected_version is null or t.pricing_version <> p_expected_version then
    raise exception 'This Product Template changed. Reload before saving.' using errcode='P0001';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_history) is distinct from 'object' then
    raise exception 'Invalid manual price payload' using errcode='22023'; end if;
  -- Supplier mode accepts only a numeric amount and an explicit currency; manual contracts stay unchanged.
  if p_mode='supplier_default' and (
    p_payload - array['default_unit_price','currency'] <> '{}'::jsonb
    or jsonb_typeof(p_payload->'default_unit_price') is distinct from 'number'
    or jsonb_typeof(p_payload->'currency') is distinct from 'string'
  ) then raise exception 'Invalid Supplier default price fields' using errcode='22023'; end if;
  price := case when p_mode in ('default','supplier_default') then (p_payload->>'default_unit_price')::numeric else (p_history->>'new_price')::numeric end;
  price_currency := case when p_mode in ('default','supplier_default') then p_payload->>'currency' else p_history->>'currency' end;
  if price is null or price < 0 or price::text in ('NaN','Infinity','-Infinity')
    or (price_currency is not null and price_currency not in ('AED','EUR','USD')) or (p_mode in ('default','supplier_default') and price_currency is null) then
    raise exception 'Invalid Product pricing currency or amount' using errcode='22023'; end if;
  if exists(select 1 from jsonb_path_query(p_payload,'$.**.currency') v where v <> 'null'::jsonb and v <> '""'::jsonb and v not in ('"AED"'::jsonb,'"EUR"'::jsonb,'"USD"'::jsonb)) then
    raise exception 'Unsupported Product currency' using errcode='22023'; end if;
  list_id := nullif(p_history->>'brand_price_list_update_id','')::uuid;
  effective_date := nullif(p_history->>'effective_from','')::date;
  if list_id is not null and not exists(select 1 from public.brand_price_list_updates where id=list_id and brand_id=t.brand_id and (p_mode in ('default','supplier_default') or status <> 'archived')) then
    raise exception 'Selected brand price list update could not be loaded' using errcode='22023'; end if;
  if p_mode='default' then
    if p_payload - array['default_unit_price','currency'] <> '{}'::jsonb then raise exception 'Invalid default price fields'; end if;
    update public.product_templates set default_unit_price=price,currency=price_currency,last_price_checked_at=now(),last_price_checked_by=auth.uid(),
      price_check_note=coalesce(nullif(p_history->>'note',''),price_check_note) where id=p_template_id returning pricing_version into result;
    if not found then raise insufficient_privilege; end if;
    insert into public.product_template_price_history(product_template_id,brand_id,brand_price_list_update_id,old_default_unit_price,new_default_unit_price,currency,effective_from,note,changed_by)
      values(t.id,t.brand_id,list_id,t.default_unit_price,price,price_currency,effective_date,p_history->>'note',auth.uid());
  elsif p_mode='supplier_default' then
    -- One price is not a completed price-list review. Existing trigger advances pricing_version.
    update public.product_templates set default_unit_price=price,currency=price_currency
      where id=p_template_id returning pricing_version into result;
    if not found then raise insufficient_privilege; end if;
    insert into public.product_template_price_history(product_template_id,brand_id,brand_price_list_update_id,old_default_unit_price,new_default_unit_price,currency,effective_from,note,changed_by)
      values(t.id,t.brand_id,list_id,t.default_unit_price,price,price_currency,effective_date,p_history->>'note',auth.uid());
  elsif p_mode='detail' then
    if source='product_components' then
      if p_payload - array['unit_price','currency'] <> '{}'::jsonb or (p_payload->>'unit_price')::numeric is distinct from price then raise exception 'Invalid component detail fields'; end if;
      select * into c from public.product_components where id=(p_history->>'source_record_id')::uuid and template_id=p_template_id for update;
      if not found then raise exception 'Component unavailable or parent changed' using errcode='P0002'; end if;
      old_price := c.unit_price;
      perform public.update_component_pricing_parent_first(p_template_id,c.id,price,coalesce(price_currency,c.currency),c.qty,c.is_active);
    else
      column_name := case source when 'product_templates.desking_size_pricing' then 'desking_size_pricing'
        when 'product_templates.variant_pricing' then 'variant_pricing' when 'product_templates.category_pricing' then 'category_pricing'
        when 'product_templates.accessory_pricing' then 'accessory_pricing' end;
      if column_name is null or p_payload - column_name <> '{}'::jsonb or jsonb_typeof(p_payload->column_name) is distinct from 'array' then
        raise exception 'Invalid detail price fields' using errcode='22023'; end if;
      -- TS derives the exact existing manual row mutation from the same checked version.
      old_price := (p_history->>'old_price')::numeric;
      update public.product_templates set
        desking_size_pricing=case when column_name='desking_size_pricing' then p_payload->column_name else desking_size_pricing end,
        variant_pricing=case when column_name='variant_pricing' then p_payload->column_name else variant_pricing end,
        category_pricing=case when column_name='category_pricing' then p_payload->column_name else category_pricing end,
        accessory_pricing=case when column_name='accessory_pricing' then p_payload->column_name else accessory_pricing end
      where id=p_template_id returning pricing_version into result;
      if not found then raise insufficient_privilege; end if;
    end if;
    insert into public.product_template_detail_price_history(product_template_id,brand_id,brand_price_list_update_id,source_table,source_record_id,price_field,old_price,new_price,currency,effective_from,note,changed_by)
      values(t.id,t.brand_id,list_id,source,p_history->>'source_record_id',p_history->>'price_field',old_price,price,price_currency,effective_date,p_history->>'note',auth.uid());
  else raise exception 'Invalid manual price mode' using errcode='22023';
  end if;
  select pricing_version into result from public.product_templates where id=p_template_id;
  return result;
end $$;

revoke all on function public.write_product_price_with_history_at_version(uuid,bigint,text,jsonb,jsonb) from public;
grant execute on function public.write_product_price_with_history_at_version(uuid,bigint,text,jsonb,jsonb) to authenticated;
commit;
