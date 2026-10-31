-- "Checked by" name assertions. After APPLY this can be run alone; before APPLY run
-- supplier_template_checks_name_TEST.sql (migration + these assertions, fully rolled back).
-- The per-product check migration (20261103100000) must already be applied.
-- Uses one existing active product only to attach a fake price list to its brand. Nothing of it is changed or kept.
begin;
select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
create function pg_temp.nm_check(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.nm_error(command text, expected text, fragment text default '') returns void language plpgsql as $$
begin begin execute command; exception when others then
  if sqlstate=expected and sqlerrm like '%'||fragment||'%' then return; end if; raise; end;
raise exception 'Expected SQLSTATE %: %',expected,command; end $$;
create function pg_temp.nm_as(uid text) returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub',uid,true); execute 'set local role authenticated'; end $$;
create temp table nm_ctx(template_id uuid, brand_id uuid, definition_id uuid, source_a uuid, source_b uuid, version bigint);
grant all on nm_ctx to authenticated;
create temp table nm_out(j jsonb);
grant all on nm_out to authenticated;

-- Users: 1 system_owner with a padded full name, 2 procurement_manager with an EMPTY name (both may write), 3 sales_designer, 4 viewer (neither may read).
insert into auth.users(id,email) select ('7e1e0000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'nm-secret-'||n||'@example.invalid' from generate_series(1,4) n;
insert into public.profiles(id,email,full_name,role,account_status)
select ('7e1e0000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'nm-secret-'||n||'@example.invalid',(array['  Dana Owner  ','   ','Sam Designer','Vera Viewer'])[n],
 ((array['system_owner','procurement_manager','sales_designer','viewer'])[n])::public.user_role,'active'::public.account_status
from generate_series(1,4) n
on conflict (id) do update set email=excluded.email, full_name=excluded.full_name, role=excluded.role, account_status=excluded.account_status;
insert into nm_ctx(template_id,brand_id,version) select id,brand_id,pricing_version from public.product_templates where is_active order by id limit 1;
do $$ begin if not exists(select 1 from nm_ctx) then raise exception 'These checks need at least one active product in the database'; end if; end $$;

-- A fake price list type covering that product, with TWO small imported sources linked to it.
select pg_temp.nm_as('7e1e0000-0000-0000-0000-000000000001');
do $$ declare c nm_ctx; d jsonb; cfg jsonb; p jsonb; s jsonb; rws jsonb; cls jsonb; i int; ids uuid[] := '{}'; begin
  select * into c from nm_ctx;
  d := public.supplier_price_review_write('definition', jsonb_build_object('brand_id',c.brand_id,'name','Name Fake List'));
  perform public.supplier_price_review_write('definition_coverage', jsonb_build_object('definition_id',d->>'id','template_ids',jsonb_build_array(c.template_id)));
  cfg := '{"full_code_column":"CODE","strategy":"exact","currency":"EUR","basis":"unknown","price_columns":[{"column":"PRICE","price_field":"unit_price"}]}'::jsonb;
  p := public.supplier_price_review_write('profile', jsonb_build_object('brand_id',c.brand_id,'title','Name Fake Profile','config',cfg));
  with v(n,code,price) as (values (1,'NM-1',10),(2,'NM-2',20))
  select jsonb_agg(jsonb_build_object('unit_key','s'||n,'sheet','S','row_number',n+1,'values',jsonb_build_object('CODE',code,'PRICE',price)) order by n),
         jsonb_agg(jsonb_build_object('unit_key',format('["s%s","PRICE"]',n),'row_key','s'||n,'code',code,'raw_code',code,'raw_article',code,'finish','','dimension','',
           'price_field','unit_price','price',price,'raw_price',price,'issues','[]'::jsonb,'companion_note','') order by n) into rws, cls from v;
  for i in 1..2 loop
    s := public.supplier_price_review_write('source', jsonb_build_object('profile_id',p->>'id','expected_profile',cfg,'title','Name Fake Source '||i,'filename','n'||i||'.xlsx','source_type','xlsx','file_hash',repeat(case i when 1 then 'e' else 'f' end,64),'expected_rows',2,'expected_cells',2,'expected_chunks',1));
    perform public.supplier_price_review_write('chunk', jsonb_build_object('source_id',s->>'id','chunk_index',0,'rows',rws,'cells',cls));
    perform public.supplier_price_review_write('finalize_source', jsonb_build_object('source_id',s->>'id'));
    perform public.supplier_price_review_write('source_definition', jsonb_build_object('source_id',s->>'id','definition_id',d->>'id'));
    ids := ids || (s->>'id')::uuid;
  end loop;
  update nm_ctx set definition_id=(d->>'id')::uuid, source_a=ids[1], source_b=ids[2];
end $$;

-- Check A by the user with a full name, check B by the user whose name is empty (existing write operation, unchanged).
do $$ declare c nm_ctx; begin
  select * into c from nm_ctx;
  perform pg_temp.nm_as('7e1e0000-0000-0000-0000-000000000001');
  perform public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id',c.definition_id,'source_id',c.source_a,'template_id',c.template_id,'expected_pricing_version',c.version::text,'line_count',2,'summary','{}'::jsonb));
  perform pg_temp.nm_as('7e1e0000-0000-0000-0000-000000000002');
  perform public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id',c.definition_id,'source_id',c.source_b,'template_id',c.template_id,'expected_pricing_version',c.version::text,'line_count',2,'summary','{}'::jsonb));
end $$;
reset role;

-- The read function returns the trimmed full name; null when the name is empty; nothing else about the person.
select pg_temp.nm_as('7e1e0000-0000-0000-0000-000000000002');
insert into nm_out select public.supplier_template_checks_latest(array[(select brand_id from nm_ctx)]);
reset role;
select pg_temp.nm_check((select (x->>'checked_by_name')='Dana Owner' from nm_out, jsonb_array_elements(j) x where x->>'source_id'=(select source_a::text from nm_ctx)),'a check by a user with a full name returns that name, trimmed');
select pg_temp.nm_check((select (x->'checked_by_name')='null'::jsonb from nm_out, jsonb_array_elements(j) x where x->>'source_id'=(select source_b::text from nm_ctx)),'an empty name returns null');
select pg_temp.nm_check((select count(*)=2 from nm_out, jsonb_array_elements(j) x where x->>'template_id'=(select template_id::text from nm_ctx)),'both checks are listed');
select pg_temp.nm_check((select bool_and((select array_agg(k order by k) from jsonb_object_keys(x) k)=array['checked_at','checked_by_name','definition_id','line_count','pricing_version','source_id','template_id']) from nm_out, jsonb_array_elements(j) x),'the same keys as before plus checked_by_name, and nothing else');
select pg_temp.nm_check((select position('nm-secret' in j::text)=0 and position('7e1e0000-0000-0000-0000-00000000000' in j::text)=0 and position('system_owner' in j::text)=0 and position('procurement_manager' in j::text)=0 from nm_out),'no email, user id or role in the output');
select pg_temp.nm_check((select bool_and((x->>'pricing_version')=(select version::text from nm_ctx) and (x->>'line_count')='2') from nm_out, jsonb_array_elements(j) x),'the other values are unchanged');
-- A check whose profile link is gone reads as null, not as an error.
update public.supplier_template_checks set checked_by=null where source_id=(select source_a from nm_ctx);
select pg_temp.nm_as('7e1e0000-0000-0000-0000-000000000001');
select pg_temp.nm_check((select (x->'checked_by_name')='null'::jsonb from jsonb_array_elements(public.supplier_template_checks_latest(array[(select brand_id from nm_ctx)])) x where x->>'source_id'=(select source_a::text from nm_ctx)),'no profile reads as null');
reset role;

-- Roles and privileges are as before.
do $$ declare uid text; c nm_ctx; begin
  select * into c from nm_ctx;
  foreach uid in array array['7e1e0000-0000-0000-0000-000000000003','7e1e0000-0000-0000-0000-000000000004','7e1e0000-0000-0000-0000-999999999999',''] loop
    perform pg_temp.nm_as(uid);
    perform pg_temp.nm_error(format($q$select public.supplier_template_checks_latest(array['%s']::uuid[])$q$,c.brand_id),'42501');
  end loop;
end $$;
reset role;
select pg_temp.nm_check(not has_function_privilege('anon','public.supplier_template_checks_latest(uuid[])','EXECUTE') and has_function_privilege('authenticated','public.supplier_template_checks_latest(uuid[])','EXECUTE'),'anon denied, authenticated allowed');
select pg_temp.nm_check((select prosecdef and coalesce(proconfig::text,'') like '%search_path%' from pg_proc where oid='public.supplier_template_checks_latest(uuid[])'::regprocedure),'still SECURITY DEFINER with a fixed search_path');
select pg_temp.nm_check((select relrowsecurity from pg_class where oid='public.supplier_template_checks'::regclass) and not has_table_privilege('authenticated','public.supplier_template_checks','SELECT'),'the table is still closed');
rollback;
select 'PASS: supplier template check name checks completed and rolled back' as result;
