-- Per-product price check sign-off assertions. After APPLY this can be run alone; before APPLY run
-- supplier_template_checks_TEST.sql (migration + these assertions, fully rolled back).
-- Uses one existing active product only to attach a fake price list to its brand. Nothing of it is changed or kept.
begin;
select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
create function pg_temp.chk_check(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.chk_error(command text, expected text, fragment text default '') returns void language plpgsql as $$
begin begin execute command; exception when others then
  if sqlstate=expected and sqlerrm like '%'||fragment||'%' then return; end if; raise; end;
raise exception 'Expected SQLSTATE %: %',expected,command; end $$;
create function pg_temp.chk_as(uid text) returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub',uid,true); execute 'set local role authenticated'; end $$;
create temp table chk_ctx(template_id uuid, brand_id uuid, definition_id uuid, source_id uuid, version bigint, other_id uuid, other_version bigint);
grant all on chk_ctx to authenticated;

-- Users: 1 system_owner, 2 procurement_manager (both may write), 3 sales_designer, 4 viewer (neither may read or write).
insert into auth.users(id,email) select ('7d1e0000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'chk-test-'||n||'@example.invalid' from generate_series(1,4) n;
insert into public.profiles(id,email,full_name,role,account_status)
select ('7d1e0000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'chk-test-'||n||'@example.invalid','Check Test '||n,
 ((array['system_owner','procurement_manager','sales_designer','viewer'])[n])::public.user_role,'active'::public.account_status
from generate_series(1,4) n
on conflict (id) do update set email=excluded.email, full_name=excluded.full_name, role=excluded.role, account_status=excluded.account_status;
insert into chk_ctx(template_id,brand_id,version) select id,brand_id,pricing_version from public.product_templates where is_active order by id limit 1;
do $$ begin if not exists(select 1 from chk_ctx) then raise exception 'These checks need at least one active product in the database'; end if; end $$;

-- A fake price list type covering that product, with one small imported source linked to it.
select pg_temp.chk_as('7d1e0000-0000-0000-0000-000000000001');
do $$ declare c chk_ctx; d jsonb; cfg jsonb; p jsonb; s jsonb; rws jsonb; cls jsonb; begin
  select * into c from chk_ctx;
  d := public.supplier_price_review_write('definition', jsonb_build_object('brand_id',c.brand_id,'name','Check Fake List'));
  perform public.supplier_price_review_write('definition_coverage', jsonb_build_object('definition_id',d->>'id','template_ids',jsonb_build_array(c.template_id)));
  cfg := '{"full_code_column":"CODE","strategy":"exact","currency":"EUR","basis":"unknown","price_columns":[{"column":"PRICE","price_field":"unit_price"}]}'::jsonb;
  p := public.supplier_price_review_write('profile', jsonb_build_object('brand_id',c.brand_id,'title','Check Fake Profile','config',cfg));
  s := public.supplier_price_review_write('source', jsonb_build_object('profile_id',p->>'id','expected_profile',cfg,'title','Check Fake Source','filename','c.xlsx','source_type','xlsx','file_hash',repeat('c',64),'expected_rows',2,'expected_cells',2,'expected_chunks',1));
  with v(n,code,price) as (values (1,'CHK-1',10),(2,'CHK-2',20))
  select jsonb_agg(jsonb_build_object('unit_key','s'||n,'sheet','S','row_number',n+1,'values',jsonb_build_object('CODE',code,'PRICE',price)) order by n),
         jsonb_agg(jsonb_build_object('unit_key',format('["s%s","PRICE"]',n),'row_key','s'||n,'code',code,'raw_code',code,'raw_article',code,'finish','','dimension','',
           'price_field','unit_price','price',price,'raw_price',price,'issues','[]'::jsonb,'companion_note','') order by n) into rws, cls from v;
  perform public.supplier_price_review_write('chunk', jsonb_build_object('source_id',s->>'id','chunk_index',0,'rows',rws,'cells',cls));
  perform public.supplier_price_review_write('finalize_source', jsonb_build_object('source_id',s->>'id'));
  perform public.supplier_price_review_write('source_definition', jsonb_build_object('source_id',s->>'id','definition_id',d->>'id'));
  update chk_ctx set definition_id=(d->>'id')::uuid, source_id=(s->>'id')::uuid;
end $$;
reset role;
-- What must never change: the product row, batches, decisions, bindings, brand baselines and components.
create temp table chk_before as select
  (select md5(to_jsonb(t)::text) from public.product_templates t where t.id=(select template_id from chk_ctx)) tpl,
  (select count(*) from public.supplier_price_batches) batches, (select count(*) from public.supplier_price_decisions) decisions,
  (select count(*) from public.supplier_price_bindings) bindings, (select count(*) from public.brand_price_list_updates) baselines, (select count(*) from public.product_components) components;

-- Another active product that is NOT covered (read here, as the database owner; the roles below never read product tables).
update chk_ctx c set other_id=o.id, other_version=o.pricing_version from (select pt.id, pt.pricing_version from public.product_templates pt where pt.is_active and pt.id<>(select template_id from chk_ctx) order by pt.id limit 1) o;

-- Neither a sales_designer nor a viewer, nor a missing profile, nor no login can write or read.
do $$ declare uid text; c chk_ctx; begin
  select * into c from chk_ctx;
  foreach uid in array array['7d1e0000-0000-0000-0000-000000000003','7d1e0000-0000-0000-0000-000000000004','7d1e0000-0000-0000-0000-999999999999',''] loop
    perform pg_temp.chk_as(uid);
    perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','%s','expected_pricing_version','%s','line_count',2,'summary','{}'::jsonb))$q$,c.definition_id,c.source_id,c.template_id,c.version),'42501');
    perform pg_temp.chk_error(format($q$select public.supplier_template_checks_latest(array['%s']::uuid[])$q$,c.brand_id),'42501');
  end loop;
end $$;
reset role;
select pg_temp.chk_check((select count(*)=0 from public.supplier_template_checks where definition_id=(select definition_id from chk_ctx)),'denied roles saved nothing');

-- An allowed role records a check; a second one for the same pair becomes the newest.
select pg_temp.chk_as('7d1e0000-0000-0000-0000-000000000002');
do $$ declare c chk_ctx; r jsonb; begin
  select * into c from chk_ctx;
  r := public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id',c.definition_id,'source_id',c.source_id,'template_id',c.template_id,'expected_pricing_version',c.version::text,'line_count',2,'summary','{"same":2}'::jsonb));
  perform pg_temp.chk_check(r->>'id' is not null,'returns the new check id');
  perform pg_temp.chk_check((select jsonb_array_length(public.supplier_template_checks_latest(array[c.brand_id]))>=1),'the check can be read');
  r := public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id',c.definition_id,'source_id',c.source_id,'template_id',c.template_id,'expected_pricing_version',c.version::text,'line_count',5,'summary','{"same":5}'::jsonb));
  perform pg_temp.chk_check((select count(*)=1 and bool_and((x->>'line_count')::int=5 and x->>'pricing_version'=c.version::text and x->>'source_id'=c.source_id::text)
    from jsonb_array_elements(public.supplier_template_checks_latest(array[c.brand_id])) x where x->>'template_id'=c.template_id::text),'only the newest check per product and price list is returned');
  -- A wrong or old pricing version is refused.
  perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','%s','expected_pricing_version','%s','line_count',2,'summary','{}'::jsonb))$q$,c.definition_id,c.source_id,c.template_id,c.version+1),'P0001','changed');
  perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','%s','expected_pricing_version','%s','line_count',2,'summary','{}'::jsonb))$q$,c.definition_id,c.source_id,c.template_id,c.version+100),'P0001','changed');
  -- An unknown product, an uncovered product and an unknown price list version are refused.
  perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','00000000-0000-0000-0000-00000000dead','expected_pricing_version','0','line_count',2,'summary','{}'::jsonb))$q$,c.definition_id,c.source_id),'P0001','Product unavailable');
  if c.other_id is not null then
    perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','%s','expected_pricing_version','%s','line_count',2,'summary','{}'::jsonb))$q$,c.definition_id,c.source_id,c.other_id,c.other_version),'P0001','not covered');
  end if;
  perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','00000000-0000-0000-0000-00000000dead','template_id','%s','expected_pricing_version','%s','line_count',2,'summary','{}'::jsonb))$q$,c.definition_id,c.template_id,c.version),'P0001','not an imported version');
  -- Bad input.
  perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','%s','expected_pricing_version','%s','line_count',0,'summary','{}'::jsonb))$q$,c.definition_id,c.source_id,c.template_id,c.version),'P0001','Choose the product');
  perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','%s','expected_pricing_version','%s','line_count',2,'summary','[]'::jsonb))$q$,c.definition_id,c.source_id,c.template_id,c.version),'P0001','Choose the product');
end $$;
reset role;
-- Nothing else was written.
select pg_temp.chk_check((select (select md5(to_jsonb(t)::text) from public.product_templates t where t.id=(select template_id from chk_ctx))=b.tpl
  and (select count(*) from public.supplier_price_batches)=b.batches and (select count(*) from public.supplier_price_decisions)=b.decisions
  and (select count(*) from public.supplier_price_bindings)=b.bindings and (select count(*) from public.brand_price_list_updates)=b.baselines
  and (select count(*) from public.product_components)=b.components from chk_before b),'no price, batch, decision, binding, baseline or component was changed');
select pg_temp.chk_check((select count(*)=2 from public.supplier_template_checks where definition_id=(select definition_id from chk_ctx)),'only the two valid checks were stored (history kept)');
-- Audit: one row per stored check, with who and what.
select pg_temp.chk_check((select count(*)=2 and bool_and(created_by='7d1e0000-0000-0000-0000-000000000002' and (metadata->>'pricing_version')=(select version::text from chk_ctx) and metadata->>'source_id'=(select source_id::text from chk_ctx))
  from public.audit_activity_log where action='supplier_template_checked' and entity_id=(select template_id from chk_ctx)),'two audit rows with the actor, source and version');
-- Closed table, closed read function, existing operations intact.
select pg_temp.chk_check((select relrowsecurity from pg_class where oid='public.supplier_template_checks'::regclass),'RLS enabled');
select pg_temp.chk_check(not has_table_privilege('authenticated','public.supplier_template_checks','SELECT') and not has_table_privilege('authenticated','public.supplier_template_checks','INSERT') and not has_table_privilege('authenticated','public.supplier_template_checks','UPDATE') and not has_table_privilege('authenticated','public.supplier_template_checks','DELETE'),'no direct table access');
select pg_temp.chk_check(not has_function_privilege('anon','public.supplier_template_checks_latest(uuid[])','EXECUTE'),'anon cannot read');
select pg_temp.chk_check(pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) like '%p_operation=''bindings''%' and pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) like '%p_operation=''archive_dimension''%','existing operations remain');
rollback;
select 'PASS: supplier template check checks completed and rolled back' as result;
