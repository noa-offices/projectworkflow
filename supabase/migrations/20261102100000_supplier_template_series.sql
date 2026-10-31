begin;

-- Phase 2: a Product saves ONE OR MORE Supplier families per Supplier price list definition (supplier_template_series).
-- Its own table: supplier_source_definition_families is replaced as a whole set whenever coverage is saved, which would wipe these choices.
-- Access only through the SECURITY DEFINER functions below (deny-by-default RLS, no policies, no grants). Additive and forward-only.
-- Nothing here changes batches, decisions, identities or any price.

-- One spelling rule for comparing families: trimmed, spaces collapsed, lower case. Comparison is always exact on this key.
create function public.supplier_family_key(p_family text) returns text language sql immutable set search_path='' as $$
  select lower(btrim(regexp_replace(coalesce(p_family, ''), '\s+', ' ', 'g')));
$$;
revoke all on function public.supplier_family_key(text) from public;
grant execute on function public.supplier_family_key(text) to authenticated;

-- The family of a family-tagged dimension (["<category>","series","<family>"...]); null for every other dimension.
create function public.supplier_dimension_family(p_dimension text) returns text language plpgsql immutable set search_path='' as $$
declare parsed jsonb;
begin
  if p_dimension is null or left(p_dimension, 1) <> '[' then return null; end if;
  parsed := p_dimension::jsonb;
  if jsonb_typeof(parsed) = 'array' and parsed ->> 1 = 'series' and jsonb_typeof(parsed -> 2) = 'string' and btrim(parsed ->> 2) <> '' then return parsed ->> 2; end if;
  return null;
exception when others then return null;
end $$;
revoke all on function public.supplier_dimension_family(text) from public;
grant execute on function public.supplier_dimension_family(text) to authenticated;

create table public.supplier_template_series (
  definition_id uuid not null references public.supplier_source_definitions(id) on delete cascade,
  template_id uuid not null references public.product_templates(id) on delete cascade,
  family text not null check (length(btrim(family)) between 1 and 200),
  family_key text not null check (family_key <> '' and family_key = lower(btrim(regexp_replace(family, '\s+', ' ', 'g')))),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (definition_id, template_id, family_key)
);
create index supplier_template_series_template on public.supplier_template_series(template_id);
alter table public.supplier_template_series enable row level security;
revoke all on public.supplier_template_series from public, anon, authenticated;

-- Saved families for one definition or one Brand. Readers who can review Supplier prices need it to match.
create function public.supplier_template_series_list(p_definition_id uuid default null, p_brand_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.current_user_can_review_brand_prices() then raise insufficient_privilege; end if;
  if p_definition_id is null and p_brand_id is null then raise exception 'Choose a Supplier price list definition or a Brand'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('definition_id', s.definition_id, 'template_id', s.template_id, 'family', s.family, 'family_key', s.family_key) order by s.definition_id, s.template_id, s.family_key)
    from public.supplier_template_series s join public.supplier_source_definitions d on d.id = s.definition_id
    where (p_definition_id is null or s.definition_id = p_definition_id) and (p_brand_id is null or d.brand_id = p_brand_id)), '[]'::jsonb);
end $$;
revoke all on function public.supplier_template_series_list(uuid, uuid) from public;
grant execute on function public.supplier_template_series_list(uuid, uuid) to authenticated;

-- The distinct families found in one Supplier price list (source version), with how many identities carry each.
create function public.supplier_source_families(p_source_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.current_user_can_review_brand_prices() then raise insufficient_privilege; end if;
  if not exists(select 1 from public.supplier_source_versions where id = p_source_id) then raise exception 'Supplier price list unavailable'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('family', f.family, 'family_key', f.family_key, 'identity_count', f.n) order by f.family_key) from (
    select public.supplier_family_key(x.fam) as family_key, min(x.fam) as family, count(*) as n
    from (select public.supplier_dimension_family(i.data ->> 'dimension') as fam from public.supplier_source_identities i where i.source_id = p_source_id) x
    where x.fam is not null group by 1) f), '[]'::jsonb);
end $$;
revoke all on function public.supplier_source_families(uuid) from public;
grant execute on function public.supplier_source_families(uuid) to authenticated;

-- Saved families of a definition that the given Supplier price list does not contain. Nothing is guessed or substituted.
create function public.supplier_template_series_missing(p_definition_id uuid, p_source_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.current_user_can_review_brand_prices() then raise insufficient_privilege; end if;
  if not exists(select 1 from public.supplier_source_definitions d join public.supplier_source_versions v on v.brand_id = d.brand_id where d.id = p_definition_id and v.id = p_source_id) then
    raise exception 'Supplier price list unavailable for this Supplier source';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('template_id', s.template_id, 'family', s.family, 'family_key', s.family_key) order by s.template_id, s.family_key)
    from public.supplier_template_series s
    where s.definition_id = p_definition_id
      and s.family_key not in (select public.supplier_family_key(public.supplier_dimension_family(i.data ->> 'dimension')) from public.supplier_source_identities i
        where i.source_id = p_source_id and public.supplier_dimension_family(i.data ->> 'dimension') is not null)), '[]'::jsonb);
end $$;
revoke all on function public.supplier_template_series_missing(uuid, uuid) from public;
grant execute on function public.supplier_template_series_missing(uuid, uuid) to authenticated;

-- Write operation: replace the whole family set of ONE product in ONE definition (an empty list clears it).
do $migration$
declare
  definition text;
  anchor constant text := $anchor$elsif p_operation='archive_dimension' then$anchor$;
  branch constant text := $branch$elsif p_operation='template_series_set' then
    if not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
    if coalesce(p_payload->>'definition_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(p_payload->>'template_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(p_payload->'families') is distinct from 'array' then
      raise exception 'Choose the Supplier price list, the product and its families';
    end if;
    if jsonb_array_length(p_payload->'families')>20
      or exists(select 1 from jsonb_array_elements(p_payload->'families') f where jsonb_typeof(f)<>'string' or length(btrim(f #>> '{}')) not between 1 and 200) then
      raise exception 'Give at most 20 families of 1-200 characters each';
    end if;
    select id into entity_id from public.supplier_source_definitions where id=(p_payload->>'definition_id')::uuid and is_active for update;
    if entity_id is null then raise exception 'Supplier price list unavailable'; end if;
    if not exists(select 1 from public.supplier_source_definition_families f
        join public.supplier_source_definitions d on d.id=f.definition_id join public.product_templates t on t.id=f.template_id
        where f.definition_id=entity_id and f.template_id=(p_payload->>'template_id')::uuid and t.is_active and t.brand_id=d.brand_id) then
      raise exception 'This product is not covered by this Supplier price list';
    end if;
    existing := coalesce((select jsonb_agg(ts.family order by ts.family_key) from public.supplier_template_series ts where ts.definition_id=entity_id and ts.template_id=(p_payload->>'template_id')::uuid),'[]'::jsonb);
    delete from public.supplier_template_series where definition_id=entity_id and template_id=(p_payload->>'template_id')::uuid;
    insert into public.supplier_template_series(definition_id,template_id,family,family_key,created_by)
      select distinct on (x.k) entity_id,(p_payload->>'template_id')::uuid,x.display,x.k,auth.uid()
      from (select public.supplier_family_key(f.value #>> '{}') k, btrim(regexp_replace(f.value #>> '{}','\s+',' ','g')) display, f.ordinality o
            from jsonb_array_elements(p_payload->'families') with ordinality f(value,ordinality)) x
      order by x.k, x.o;
    insert into public.audit_activity_log(entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by)
      values('supplier_template_series',(p_payload->>'template_id')::uuid,'supplier_source_definition',entity_id,'supplier_template_series_set','Supplier families saved for a product',
        jsonb_array_length(p_payload->'families')||' family choice(s)',
        jsonb_build_object('before',existing,'after',coalesce((select jsonb_agg(ts.family order by ts.family_key) from public.supplier_template_series ts where ts.definition_id=entity_id and ts.template_id=(p_payload->>'template_id')::uuid),'[]'::jsonb)),auth.uid());
    entity_id := (p_payload->>'template_id')::uuid;
  elsif p_operation='archive_dimension' then$branch$;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  if position('template_series_set' in definition)>0
    or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Deployed supplier review RPC differs from the expected body; review before migrating';
  end if;
  execute replace(definition,anchor,branch);
end $migration$;

commit;
