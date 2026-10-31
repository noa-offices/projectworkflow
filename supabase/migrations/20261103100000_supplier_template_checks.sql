begin;

-- A per-product "price checked" sign-off: one Product (product_templates row) is marked checked against one Supplier price list
-- (source version) WITHOUT completing the brand-wide review. Insert-only history; the newest row per (source_id, template_id) counts.
-- The sign-off remembers the product's pricing_version, so a later price edit makes it stale ("edited since check").
-- Access only through the SECURITY DEFINER functions below (deny-by-default RLS, no policies, no grants). Forward-only.
-- It never changes a price, a review batch, a decision or a brand baseline.

create table public.supplier_template_checks (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.supplier_source_definitions(id) on delete cascade,
  source_id uuid not null references public.supplier_source_versions(id) on delete cascade,
  template_id uuid not null references public.product_templates(id) on delete cascade,
  pricing_version bigint not null,
  line_count int not null check (line_count > 0),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  checked_by uuid references public.profiles(id),
  checked_at timestamptz not null default clock_timestamp()
);
create index supplier_template_checks_lookup on public.supplier_template_checks(source_id, template_id, checked_at desc);
create index supplier_template_checks_template on public.supplier_template_checks(template_id);
alter table public.supplier_template_checks enable row level security;
revoke all on public.supplier_template_checks from public, anon, authenticated;

-- The newest check per (source, product) for the given brands. Readers who can review Supplier prices need it to show the status.
create function public.supplier_template_checks_latest(p_brand_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.current_user_can_review_brand_prices() then raise insufficient_privilege; end if;
  if p_brand_ids is null or cardinality(p_brand_ids) not between 1 and 50 then raise exception 'Choose between 1 and 50 brands'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('template_id', x.template_id, 'source_id', x.source_id, 'definition_id', x.definition_id,
      'pricing_version', x.pricing_version::text, 'line_count', x.line_count, 'checked_at', x.checked_at) order by x.source_id, x.template_id)
    from (select distinct on (c.source_id, c.template_id) c.source_id, c.template_id, c.definition_id, c.pricing_version, c.line_count, c.checked_at
          from public.supplier_template_checks c join public.supplier_source_definitions d on d.id = c.definition_id
          where d.brand_id = any(p_brand_ids)
          order by c.source_id, c.template_id, c.checked_at desc, c.id desc) x), '[]'::jsonb);
end $$;
revoke all on function public.supplier_template_checks_latest(uuid[]) from public;
grant execute on function public.supplier_template_checks_latest(uuid[]) to authenticated;

-- Write operation: record one sign-off. The server has already rebuilt a clean comparison; the database re-checks what it can own.
do $migration$
declare
  definition text;
  anchor constant text := $anchor$elsif p_operation='archive_dimension' then$anchor$;
  branch constant text := $branch$elsif p_operation='template_check_set' then
    if not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
    if coalesce(p_payload->>'definition_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(p_payload->>'source_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(p_payload->>'template_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(p_payload->>'expected_pricing_version','') !~ '^[0-9]{1,18}$'
      or coalesce(p_payload->>'line_count','') !~ '^[1-9][0-9]{0,8}$'
      or jsonb_typeof(p_payload->'summary') is distinct from 'object' or octet_length((p_payload->'summary')::text) > 20000 then
      raise exception 'Choose the product, the price list, its version and the checked lines';
    end if;
    -- Lock the product and compare its pricing version (brand_basis is only a text holder here).
    select tpl.pricing_version::text into brand_basis from public.product_templates tpl where tpl.id=(p_payload->>'template_id')::uuid and tpl.is_active for update;
    if brand_basis is null then raise exception 'Product unavailable'; end if;
    if brand_basis <> ((p_payload->>'expected_pricing_version')::bigint)::text then
      raise exception 'This Product Template changed. Build a fresh comparison before marking it checked.';
    end if;
    select defn.id into entity_id from public.supplier_source_definitions defn where defn.id=(p_payload->>'definition_id')::uuid and defn.is_active for share;
    if entity_id is null then raise exception 'Supplier price list unavailable'; end if;
    if not exists(select 1 from public.supplier_source_definition_families fam
        join public.supplier_source_definitions defn on defn.id=fam.definition_id join public.product_templates tpl on tpl.id=fam.template_id
        where fam.definition_id=entity_id and fam.template_id=(p_payload->>'template_id')::uuid and tpl.is_active and tpl.brand_id=defn.brand_id) then
      raise exception 'This product is not covered by this Supplier price list';
    end if;
    if not exists(select 1 from public.supplier_source_versions src where src.id=(p_payload->>'source_id')::uuid and src.definition_id=entity_id and src.status='imported') then
      raise exception 'This is not an imported version of this Supplier price list';
    end if;
    insert into public.supplier_template_checks(definition_id,source_id,template_id,pricing_version,line_count,summary,checked_by)
      values(entity_id,(p_payload->>'source_id')::uuid,(p_payload->>'template_id')::uuid,brand_basis::bigint,(p_payload->>'line_count')::int,p_payload->'summary',auth.uid())
      returning id into entity_id;
    insert into public.audit_activity_log(entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by)
      values('supplier_template_check',(p_payload->>'template_id')::uuid,'supplier_source_definition',(p_payload->>'definition_id')::uuid,'supplier_template_checked','Product marked as price checked',
        (p_payload->>'line_count')||' price line(s) matched the Supplier price list',
        jsonb_build_object('source_id',p_payload->>'source_id','pricing_version',brand_basis,'line_count',(p_payload->>'line_count')::int,'summary',p_payload->'summary'),auth.uid());
  elsif p_operation='archive_dimension' then$branch$;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  if position('template_check_set' in definition)>0
    or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Deployed supplier review RPC differs from the expected body; review before migrating';
  end if;
  execute replace(definition,anchor,branch);
end $migration$;

commit;
