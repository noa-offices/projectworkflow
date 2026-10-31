-- RUN FIRST: supplier product family preview. The migration and the tests are fully rolled back. Nothing is saved.
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

select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
create function pg_temp.tseries_check(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.tseries_error(command text, expected text, fragment text default '') returns void language plpgsql as $$
begin begin execute command; exception when others then
  if sqlstate=expected and sqlerrm like '%'||fragment||'%' then return; end if; raise; end;
raise exception 'Expected SQLSTATE %: %',expected,command; end $$;
create function pg_temp.tseries_as(uid text) returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub',uid,true); execute 'set local role authenticated'; end $$;
create temp table tseries_ctx(template_id uuid, brand_id uuid, definition_id uuid, source_id uuid);
grant all on tseries_ctx to authenticated;

-- Users: 1 system_owner, 2 procurement_manager (both may write), 3 sales_designer, 4 viewer (neither may read or write).
insert into auth.users(id,email) select ('7c1e0000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'tseries-test-'||n||'@example.invalid' from generate_series(1,4) n;
insert into public.profiles(id,email,full_name,role,account_status)
select ('7c1e0000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'tseries-test-'||n||'@example.invalid','Family Test '||n,
 ((array['system_owner','procurement_manager','sales_designer','viewer'])[n])::public.user_role,'active'::public.account_status
from generate_series(1,4) n
on conflict (id) do update set email=excluded.email, full_name=excluded.full_name, role=excluded.role, account_status=excluded.account_status;
insert into tseries_ctx(template_id,brand_id) select id,brand_id from public.product_templates where is_active order by id limit 1;
do $$ begin if not exists(select 1 from tseries_ctx) then raise exception 'These checks need at least one active product in the database'; end if; end $$;

-- A fake definition for that product's brand, covering that product, plus a small family-tagged price list (AIM, EVERY, Goal-Air).
select pg_temp.tseries_as('7c1e0000-0000-0000-0000-000000000001');
do $$ declare c tseries_ctx; d jsonb; cfg jsonb; p jsonb; s jsonb; rws jsonb; cls jsonb; begin
  select * into c from tseries_ctx;
  d := public.supplier_price_review_write('definition', jsonb_build_object('brand_id',c.brand_id,'name','Family Fake List'));
  perform public.supplier_price_review_write('definition_coverage', jsonb_build_object('definition_id',d->>'id','template_ids',jsonb_build_array(c.template_id)));
  cfg := '{"full_code_column":"CODE","strategy":"exact","currency":"EUR","basis":"unknown","category_column":"CAT","series_column":"FAM","price_columns":[{"column":"PRICE","price_field":"unit_price"}]}'::jsonb;
  p := public.supplier_price_review_write('profile', jsonb_build_object('brand_id',c.brand_id,'title','Family Fake Profile','config',cfg));
  s := public.supplier_price_review_write('source', jsonb_build_object('profile_id',p->>'id','expected_profile',cfg,'title','Family Fake Source','filename','f.xlsx','source_type','xlsx','file_hash',repeat('b',64),'expected_rows',3,'expected_cells',3,'expected_chunks',1));
  with v(n,code,price,fam) as (values (1,'521234',57,'AIM'),(2,'521234',58,'EVERY'),(3,'521234',57,'Goal-Air'))
  select jsonb_agg(jsonb_build_object('unit_key','s'||n,'sheet','S','row_number',n+1,'values',jsonb_build_object('CODE',code,'PRICE',price,'CAT','','FAM',fam)) order by n),
         jsonb_agg(jsonb_build_object('unit_key',format('["s%s","PRICE"]',n),'row_key','s'||n,'code',code,'raw_code',code,'raw_article',code,'finish','','dimension',format('["","series","%s"]',fam),
           'price_field','unit_price','price',price,'raw_price',price,'issues','[]'::jsonb,'companion_note','') order by n) into rws, cls from v;
  perform public.supplier_price_review_write('chunk', jsonb_build_object('source_id',s->>'id','chunk_index',0,'rows',rws,'cells',cls));
  perform public.supplier_price_review_write('finalize_source', jsonb_build_object('source_id',s->>'id'));
  update tseries_ctx set definition_id=(d->>'id')::uuid, source_id=(s->>'id')::uuid;
end $$;
reset role;

-- Roles: neither a sales_designer nor a viewer can write or read.
do $$ declare uid text; c tseries_ctx; begin
  select * into c from tseries_ctx;
  foreach uid in array array['7c1e0000-0000-0000-0000-000000000003','7c1e0000-0000-0000-0000-000000000004',''] loop
    perform pg_temp.tseries_as(uid);
    perform pg_temp.tseries_error(format($q$select public.supplier_price_review_write('template_series_set',jsonb_build_object('definition_id','%s','template_id','%s','families','["EVERY"]'::jsonb))$q$,c.definition_id,c.template_id),'42501');
    perform pg_temp.tseries_error(format($q$select public.supplier_template_series_list('%s')$q$,c.definition_id),'42501');
    perform pg_temp.tseries_error(format($q$select public.supplier_source_families('%s')$q$,c.source_id),'42501');
    perform pg_temp.tseries_error(format($q$select public.supplier_template_series_missing('%s','%s')$q$,c.definition_id,c.source_id),'42501');
  end loop;
end $$;
reset role;
select pg_temp.tseries_check((select count(*)=0 from public.supplier_template_series where definition_id=(select definition_id from tseries_ctx)),'denied roles saved nothing');

-- An allowed role saves, replaces, de-duplicates by key and clears.
select pg_temp.tseries_as('7c1e0000-0000-0000-0000-000000000002');
do $$ declare c tseries_ctx; r jsonb; begin
  select * into c from tseries_ctx;
  r := public.supplier_price_review_write('template_series_set',jsonb_build_object('definition_id',c.definition_id,'template_id',c.template_id,'families','["EVERY","  every ","Goal-Air"]'::jsonb));
  perform pg_temp.tseries_check(r->>'id'=c.template_id::text,'returns the product id');
  perform pg_temp.tseries_check((select jsonb_array_length(public.supplier_template_series_list(c.definition_id))=2),'two families after de-duplication by key');
  perform pg_temp.tseries_check((select bool_and(x->>'family_key'=lower(x->>'family')) from jsonb_array_elements(public.supplier_template_series_list(c.definition_id)) x),'family_key is the lower-case key');
  perform pg_temp.tseries_check((select jsonb_array_length(public.supplier_template_series_list(null,c.brand_id))>=2),'the brand list includes them');
  perform public.supplier_price_review_write('template_series_set',jsonb_build_object('definition_id',c.definition_id,'template_id',c.template_id,'families','["AIM"]'::jsonb));
  perform pg_temp.tseries_check((select public.supplier_template_series_list(c.definition_id)->0->>'family_key'='aim' and jsonb_array_length(public.supplier_template_series_list(c.definition_id))=1),'the whole set was replaced');
  perform public.supplier_price_review_write('template_series_set',jsonb_build_object('definition_id',c.definition_id,'template_id',c.template_id,'families','[]'::jsonb));
  perform pg_temp.tseries_check(jsonb_array_length(public.supplier_template_series_list(c.definition_id))=0,'an empty list clears it');
  -- Bad input gives clear errors and saves nothing.
  perform pg_temp.tseries_error(format($q$select public.supplier_price_review_write('template_series_set',jsonb_build_object('definition_id','%s','template_id','00000000-0000-0000-0000-00000000dead','families','["EVERY"]'::jsonb))$q$,c.definition_id),'P0001','not covered');
  perform pg_temp.tseries_error(format($q$select public.supplier_price_review_write('template_series_set',jsonb_build_object('definition_id','00000000-0000-0000-0000-00000000dead','template_id','%s','families','["EVERY"]'::jsonb))$q$,c.template_id),'P0001','unavailable');
  perform pg_temp.tseries_error(format($q$select public.supplier_price_review_write('template_series_set',jsonb_build_object('definition_id','%s','template_id','%s','families','"EVERY"'::jsonb))$q$,c.definition_id,c.template_id),'P0001','Choose the Supplier price list');
  perform pg_temp.tseries_error(format($q$select public.supplier_price_review_write('template_series_set',jsonb_build_object('definition_id','%s','template_id','%s','families','["  "]'::jsonb))$q$,c.definition_id,c.template_id),'P0001','1-200');
  -- The family set survives a coverage re-save.
  perform public.supplier_price_review_write('template_series_set',jsonb_build_object('definition_id',c.definition_id,'template_id',c.template_id,'families','["EVERY","Not In List"]'::jsonb));
  perform public.supplier_price_review_write('definition_coverage',jsonb_build_object('definition_id',c.definition_id,'template_ids',jsonb_build_array(c.template_id)));
  perform pg_temp.tseries_check(jsonb_array_length(public.supplier_template_series_list(c.definition_id))=2,'the family set survives a coverage re-save');
  -- Read functions: the families in the list, and the saved family it does not contain (nothing is guessed).
  perform pg_temp.tseries_check((select jsonb_agg(x->>'family_key' order by x->>'family_key') from jsonb_array_elements(public.supplier_source_families(c.source_id)) x)='["aim","every","goal-air"]'::jsonb,'distinct families found in the list');
  perform pg_temp.tseries_check((select jsonb_array_length(public.supplier_template_series_missing(c.definition_id,c.source_id))=1 and public.supplier_template_series_missing(c.definition_id,c.source_id)->0->>'family_key'='not in list'),'the saved family missing from the list is reported');
end $$;
reset role;
-- Audit, closed table, closed functions.
select pg_temp.tseries_check((select count(*)=4 from public.audit_activity_log where action='supplier_template_series_set' and parent_entity_id=(select definition_id from tseries_ctx)),'one audit row per successful save');
select pg_temp.tseries_check((select (metadata->'before')='["AIM"]'::jsonb and (metadata->'after')='[]'::jsonb from public.audit_activity_log where action='supplier_template_series_set' and parent_entity_id=(select definition_id from tseries_ctx) and (metadata->'after')='[]'::jsonb),'audit keeps before and after');
select pg_temp.tseries_check((select relrowsecurity from pg_class where oid='public.supplier_template_series'::regclass),'RLS enabled');
select pg_temp.tseries_check(not has_table_privilege('authenticated','public.supplier_template_series','SELECT') and not has_table_privilege('authenticated','public.supplier_template_series','INSERT') and not has_table_privilege('authenticated','public.supplier_template_series','UPDATE') and not has_table_privilege('authenticated','public.supplier_template_series','DELETE'),'no direct table access');
select pg_temp.tseries_check(not has_function_privilege('anon','public.supplier_template_series_list(uuid,uuid)','EXECUTE') and not has_function_privilege('anon','public.supplier_source_families(uuid)','EXECUTE') and not has_function_privilege('anon','public.supplier_template_series_missing(uuid,uuid)','EXECUTE'),'anon cannot read');
select pg_temp.tseries_check(pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) like '%p_operation=''bindings''%' and pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) like '%p_operation=''archive_dimension''%','existing operations remain');
rollback;
select 'PASS: supplier template family checks completed and rolled back' as result;
