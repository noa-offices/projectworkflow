-- Supplier family / sub-family import assertions. After APPLY this can be run alone; before APPLY run
-- supplier_series_import_TEST.sql (migration + these assertions, fully rolled back).
-- Fake rows only. Everything is rolled back.
begin;
select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
create function pg_temp.series_check(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.series_as(uid text) returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub',uid,true); execute 'set local role authenticated'; end $$;
create temp table series_ids(source_id uuid);
grant all on series_ids to authenticated;

insert into auth.users(id,email) values ('5e1e0000-0000-0000-0000-000000000001','series-test@example.invalid');
insert into public.profiles(id,email,full_name,role,account_status)
values ('5e1e0000-0000-0000-0000-000000000001','series-test@example.invalid','Series Test','system_owner','active')
on conflict (id) do update set email=excluded.email, full_name=excluded.full_name, role=excluded.role, account_status=excluded.account_status;
insert into public.brands(id,name) values ('5e1e0000-0000-0000-0001-000000000001','Series Fake Brand');

-- The helper that gives the plain category back.
select pg_temp.series_check(public.supplier_plain_dimension('SG3')='SG3','a plain category is unchanged');
select pg_temp.series_check(public.supplier_plain_dimension('')='','an empty dimension is unchanged');
select pg_temp.series_check(public.supplier_plain_dimension('["SG3","series","EVERY"]')='SG3','family tag removed');
select pg_temp.series_check(public.supplier_plain_dimension('["","series","EVERY","Silver"]')='','empty category stays empty');
select pg_temp.series_check(public.supplier_plain_dimension('["SG3", "series", "EVERY"]')='SG3','spacing does not matter');
select pg_temp.series_check(public.supplier_plain_dimension('["x","finish_set",["a"]]')='["x","finish_set",["a"]]','a finish set is unchanged');
select pg_temp.series_check(public.supplier_plain_dimension('["broken')='["broken','text that is not JSON is unchanged');
select pg_temp.series_check(public.supplier_plain_dimension(null) is null,'null stays null');
-- The two optional columns are kept; a profile without them keeps exactly what it kept before.
select pg_temp.series_check(public.supplier_retained_values('{"series_column":"FAM","subfamily_column":"SUB"}','{"FAM":"a","SUB":"b","X":"c"}')='{"FAM":"a","SUB":"b"}'::jsonb,'family and sub-family columns are retained');
select pg_temp.series_check(public.supplier_retained_values('{"category_column":"CAT"}','{"FAM":"a","CAT":"c"}')='{"CAT":"c"}'::jsonb,'without the settings the family column is not retained');
-- Both finalize bodies use it.
select pg_temp.series_check(pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) like '%''raw_dimension'',public.supplier_plain_dimension(dimension)%','single-statement finalize patched');
select pg_temp.series_check(pg_get_functiondef('public.supplier_finalize_source_step(uuid,integer)'::regprocedure) like '%''raw_dimension'',public.supplier_plain_dimension(dimension)%','staged finalize patched');

-- End to end through the real RPC as an allowed user: the Every case, an in-family conflict, and a row without a family.
select pg_temp.series_as('5e1e0000-0000-0000-0000-000000000001');
do $$ declare cfg jsonb; p jsonb; s jsonb; rws jsonb; cls jsonb; begin
  cfg := '{"full_code_column":"CODE","strategy":"exact","currency":"EUR","basis":"unknown","category_column":"CAT","series_column":"FAM","subfamily_column":"SUB","price_columns":[{"column":"PRICE","price_field":"unit_price"}]}'::jsonb;
  p := public.supplier_price_review_write('profile', jsonb_build_object('brand_id','5e1e0000-0000-0000-0001-000000000001','title','Series Fake Profile','config',cfg));
  s := public.supplier_price_review_write('source', jsonb_build_object('profile_id',p->>'id','expected_profile',cfg,'title','Series Fake List','filename','s.xlsx','source_type','xlsx','file_hash',repeat('a',64),'expected_rows',7,'expected_cells',7,'expected_chunks',1));
  insert into series_ids values ((s->>'id')::uuid);
  with v(n,code,price,cat,fam,sub) as (values (1,'521234',57,'','AIM','AIM'),(2,'521234',58,'','EVERY','Silver'),(3,'521234',57,'','Goal-Air','Goal-Air'),(4,'521234',58,'','EVERY','Plain'),(5,'777001',10,'SG3','EVERY','Silver'),(6,'777001',12,'SG3','EVERY','Silver'),(7,'888001',5,'','',''))
  select jsonb_agg(jsonb_build_object('unit_key','s'||n,'sheet','S','row_number',n+1,'values',jsonb_build_object('CODE',code,'PRICE',price,'CAT',cat,'FAM',fam,'SUB',sub)) order by n),
         jsonb_agg(jsonb_build_object('unit_key',format('["s%s","PRICE"]',n),'row_key','s'||n,'code',code,'raw_code',code,'raw_article',code,'finish','',
           'dimension',case when fam<>'' then format('["%s","series","%s","%s"]',cat,fam,sub) else cat end,'price_field','unit_price','price',price,'raw_price',price,'issues','[]'::jsonb,'companion_note','') order by n)
  into rws, cls from v;
  perform public.supplier_price_review_write('chunk', jsonb_build_object('source_id',s->>'id','chunk_index',0,'rows',rws,'cells',cls));
  perform public.supplier_price_review_write('finalize_source', jsonb_build_object('source_id',s->>'id'));
end $$;
reset role;
select pg_temp.series_check((select count(*)=6 from public.supplier_source_identities where source_id=(select source_id from series_ids)),'six identities: four for 521234, one merged 777001, one 888001');
select pg_temp.series_check((select count(*)=4 and bool_and(not (data->'issues' ? 'conflicting_source_prices')) and bool_and(jsonb_array_length(key::jsonb)=3) and bool_and(data->>'raw_dimension'='')
  from public.supplier_source_identities where source_id=(select source_id from series_ids) and code='521234'),'521234 under several families: separate identities, no conflict, 3-part keys, plain raw_dimension');
select pg_temp.series_check((select count(*)=1 and bool_and(data->'issues' ? 'conflicting_source_prices') and bool_and(data->'price'='null'::jsonb) and bool_and(data->>'raw_dimension'='SG3')
  from public.supplier_source_identities where source_id=(select source_id from series_ids) and code='777001'),'a real conflict inside one family is still flagged, with the plain category kept');
select pg_temp.series_check((select count(*)=1 and bool_and(data->>'dimension'='') and bool_and(key::jsonb=jsonb_build_array('888001','unit_price',''))
  from public.supplier_source_identities where source_id=(select source_id from series_ids) and code='888001'),'a row without a family keeps today''s dimension and key');
select pg_temp.series_check((select count(*)>=1 from public.supplier_source_identities i, jsonb_array_elements(i.data->'evidence') e
  where i.source_id=(select source_id from series_ids) and i.code='521234' and e->>'family_label'='EVERY' and e->>'subfamily_label'='Silver'),'evidence shows the family and sub-family labels');
rollback;
select 'PASS: supplier series import checks completed and rolled back' as result;
