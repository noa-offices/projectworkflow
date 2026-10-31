-- Product Supplier families assertions. After APPLY this can be run alone; before APPLY run
-- supplier_template_series_TEST.sql (migration + these assertions, fully rolled back).
-- Uses one existing active product only to attach a fake price list definition to its brand. Nothing of it is changed or kept.
begin;
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
