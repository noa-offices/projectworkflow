-- Phase 1a-1 only. No live application, import tables, status rewrite, or writer cutover.
begin;
create schema if not exists pricing_private;
revoke all on schema pricing_private from public;

alter table public.product_templates add column if not exists pricing_version bigint not null default 0;
alter table public.product_templates add column if not exists creation_legacy boolean not null default false;
alter table public.brands add column if not exists stored_price_basis text not null default 'unknown';
alter table public.brands drop constraint if exists brands_stored_price_basis_check;
alter table public.brands add constraint brands_stored_price_basis_check check (stored_price_basis in ('list','net','unknown'));
alter table public.brand_price_list_updates add column if not exists coverage_mode text not null default 'legacy';
alter table public.brand_price_list_updates drop constraint if exists brand_price_list_updates_coverage_mode_check;
alter table public.brand_price_list_updates add constraint brand_price_list_updates_coverage_mode_check check (coverage_mode in ('complete','selected_templates','partial','legacy'));

create or replace function pricing_private.backfill_columns(groups jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare g jsonb; result jsonb := '[]'; columns jsonb; label text; code text; codes text[]; keys text[];
begin
  if jsonb_typeof(groups) <> 'array' then raise exception 'Pricing groups must be arrays'; end if;
  for g in select value from jsonb_array_elements(groups) loop
    if jsonb_typeof(g->'items') = 'array' and coalesce(g->>'modular_pricing_mode','') <> 'direct' and not (g ? 'price_columns') then
      columns := '[]'; codes := '{}'; keys := '{}';
      -- Exact existing keys, never normalized/re-keyed; declared order remains authoritative.
      for label in
        select key from (
          select value #>> '{}' as key, ordinal::bigint as ordinal from jsonb_array_elements(coalesce(g->'price_categories','[]')) with ordinality x(value,ordinal)
          union all
          select k, 1000000 + row_number() over (order by n,k) from jsonb_array_elements(g->'items') with ordinality r(v,n)
            cross join lateral jsonb_object_keys(coalesce(v->'prices','{}')) k
        ) candidates order by ordinal
      loop
        if label = any(keys) then continue; end if;
        code := trim(both '_' from regexp_replace(lower(label), '[^a-z0-9]+', '_', 'g'));
        if code = '' or code = any(codes) then raise exception 'Pricing column dimension collision: group %, label %', g->>'id', label; end if;
        keys := array_append(keys,label); codes := array_append(codes,code);
        columns := columns || jsonb_build_array(jsonb_build_object('id',label,'label',label,'dimension_code',code));
      end loop;
      g := g || jsonb_build_object('price_columns',columns);
    end if;
    result := result || jsonb_build_array(g);
  end loop;
  return result;
end $$;
update public.product_templates set category_pricing = pricing_private.backfill_columns(category_pricing)
where category_pricing is distinct from pricing_private.backfill_columns(category_pricing);
drop function pricing_private.backfill_columns(jsonb);

-- Freeze only deterministic creation-shortcut evidence against the legacy checked-date fallback.
-- Do not synthesize check timestamps, actors, or verified complete-list coverage.
update public.product_templates t set creation_legacy = true
from public.brands b
where t.brand_id=b.id and t.is_active and not t.creation_legacy
  and b.last_price_list_checked_at is not null and b.last_price_list_checked_at <= now()
  and (t.created_at at time zone 'UTC')::date >= (b.last_price_list_checked_at at time zone 'UTC')::date
  and (t.last_price_checked_at is null or (t.last_price_checked_at at time zone 'UTC')::date < (b.last_price_list_checked_at at time zone 'UTC')::date)
  and not exists (select 1 from public.brand_price_list_updates u where u.brand_id=b.id and u.status in ('draft','active'));

create or replace function pricing_private.template_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.default_unit_price is distinct from old.default_unit_price
    or new.currency is distinct from old.currency
    or new.variant_pricing is distinct from old.variant_pricing
    or new.category_pricing is distinct from old.category_pricing
    or new.desking_size_pricing is distinct from old.desking_size_pricing
    or new.accessory_pricing is distinct from old.accessory_pricing then
    new.pricing_version := old.pricing_version + 1;
  elsif pg_trigger_depth() > 1 and new.pricing_version = old.pricing_version + 1 then
    -- A component trigger advances the token without changing template JSON.
    null;
  else
    -- Clients cannot replace/reset the concurrency token on metadata-only updates.
    new.pricing_version := old.pricing_version;
  end if;
  return new;
end $$;
drop trigger if exists product_template_pricing_version on public.product_templates;
create trigger product_template_pricing_version before update on public.product_templates for each row execute function pricing_private.template_version();

create or replace function pricing_private.component_version() returns trigger
language plpgsql set search_path = '' as $$
declare parents uuid[]; parent uuid;
begin
  if tg_op = 'UPDATE' and new.unit_price is not distinct from old.unit_price
    and new.currency is not distinct from old.currency and new.qty is not distinct from old.qty
    and new.is_active is not distinct from old.is_active and new.template_id is not distinct from old.template_id then return new; end if;
  if tg_op = 'INSERT' then parents := array[new.template_id];
  elsif tg_op = 'DELETE' then parents := array[old.template_id];
  else parents := array[old.template_id,new.template_id]; end if;
  for parent in select distinct p from unnest(parents) p order by p loop
    update public.product_templates set pricing_version=pricing_version+1 where id=parent;
  end loop;
  -- A cascaded parent deletion simply affects zero parent rows.
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists product_component_pricing_version on public.product_components;
create trigger product_component_pricing_version after insert or update or delete on public.product_components for each row execute function pricing_private.component_version();

-- Narrow parent-first foundation. Existing writer conversion belongs to 1a-2.
-- Invoker security preserves existing RLS; no role/access expansion.
create or replace function public.update_component_pricing_parent_first(
  p_template_id uuid, p_component_id uuid, p_unit_price numeric, p_currency text, p_qty numeric, p_is_active boolean
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not public.current_user_is_active() then raise insufficient_privilege; end if;
  if p_currency not in ('AED','EUR','USD') or p_currency is null
    or p_unit_price is null or p_unit_price < 0 or p_qty is null or p_qty < 0 or p_is_active is null
    or p_unit_price::text in ('NaN','Infinity','-Infinity') or p_qty::text in ('NaN','Infinity','-Infinity')
    then raise exception 'Invalid component pricing' using errcode='22023'; end if;
  perform 1 from public.product_templates where id=p_template_id for update;
  if not found then raise exception 'Parent template unavailable' using errcode='P0002'; end if;
  update public.product_components set unit_price=p_unit_price,currency=p_currency,qty=p_qty,is_active=p_is_active
    where id=p_component_id and template_id=p_template_id;
  if not found then raise exception 'Component unavailable or parent changed' using errcode='P0002'; end if;
end $$;
revoke all on function public.update_component_pricing_parent_first(uuid,uuid,numeric,text,numeric,boolean) from public;
grant execute on function public.update_component_pricing_parent_first(uuid,uuid,numeric,text,numeric,boolean) to authenticated;
revoke all on all functions in schema pricing_private from public;
commit;
