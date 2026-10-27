-- Task 19b assertions. After APPLY this can be run alone; before APPLY run
-- supplier_price_review_decisions_TEST.sql (migration + these assertions, rolled back).
begin;
select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
create function pg_temp.review_check(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.review_error(command text, expected text) returns void language plpgsql as $$
begin begin execute command; exception when others then if sqlstate=expected then return; end if; raise; end;
raise exception 'Expected SQLSTATE %: %',expected,command; end $$;
create function pg_temp.review_as(uid text) returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub',uid,true); execute 'set local role authenticated'; end $$;

-- Reserved fake IDs only. Profile upserts also work with the auth.users profile trigger.
insert into auth.users(id,email) select ('19b00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, 'review-test-'||n||'@example.invalid' from generate_series(1,11) n;
insert into public.profiles(id,email,full_name,role,account_status)
select ('19b00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'review-test-'||n||'@example.invalid',
 (array['Olivia Review Owner','Amal Review Manager','Priya Review Procurement','Samir Review Sales','Sara Review Coordinator','Dina Review Designer','Vera Review Viewer','Waleed Review Warehouse','Dana Disabled Owner','Pavel Pending Manager',''])[n],
 ((array['system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','viewer','warehouse_staff','system_owner','admin_manager','admin_manager'])[n])::public.user_role,
 (case when n=9 then 'disabled' when n=10 then 'pending' else 'active' end)::public.account_status
from generate_series(1,11) n
on conflict (id) do update set email=excluded.email, full_name=excluded.full_name, role=excluded.role, account_status=excluded.account_status;
insert into public.brands(id,name) values ('19b00000-0000-0000-0001-000000000001','Task 19b Fake Brand');
insert into public.supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,expected_rows,expected_cells,expected_chunks,created_by)
values ('19b00000-0000-0000-0002-000000000001','19b00000-0000-0000-0001-000000000001','Task 19b Fake List','fake.csv','19b-fake','csv','EUR','list','{}','imported',1,1,1,'19b00000-0000-0000-0000-000000000001');

create function pg_temp.review_payload(patch jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_array('{"supplier_source_id":"19b00000-0000-0000-0002-000000000001","supplier_price_list_label":"Task 19b Fake List","model_code":"FAKE-19B-A1","price_field":"unit_price","category":null,"imported_price":120,"supplier_price":100,"currency":"EUR","decision":"use_supplier","custom_price":null,"note":null,"status":"open"}'::jsonb || patch)
$$;

-- Every non-manager role, inactive managers, no profile, and unauthenticated calls fail.
do $$ declare n int; uid text; begin
 for n in 3..10 loop
  uid := '19b00000-0000-0000-0000-'||lpad(n::text,12,'0'); perform pg_temp.review_as(uid);
  perform pg_temp.review_error('select public.save_supplier_price_decisions(pg_temp.review_payload())','42501');
  perform pg_temp.review_error($q$select public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')$q$,'42501');
 end loop;
 perform pg_temp.review_as('19b00000-0000-0000-0000-999999999999');
 perform pg_temp.review_error('select public.save_supplier_price_decisions(pg_temp.review_payload())','42501');
 perform pg_temp.review_as('');
 perform pg_temp.review_error('select public.save_supplier_price_decisions(pg_temp.review_payload())','42501');
end $$;

select pg_temp.review_as('19b00000-0000-0000-0000-000000000001');
select pg_temp.review_check(jsonb_array_length(public.save_supplier_price_decisions(pg_temp.review_payload()))=1,'owner can save');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'decided_by_name'='Olivia Review Owner','full name, despite profiles RLS');
select pg_temp.review_error($q$select * from public.supplier_price_review_decisions where supplier_source_id='19b00000-0000-0000-0002-000000000001'$q$,'42501');
select pg_temp.review_error($q$update public.supplier_price_review_decisions set note='bypass' where supplier_source_id='19b00000-0000-0000-0002-000000000001'$q$,'42501');

select pg_temp.review_as('19b00000-0000-0000-0000-000000000002');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'decided_by_name'='Olivia Review Owner','another saver full name works through profiles RLS');
select set_config('review.previous_id',public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'id',true);
select set_config('review.previous_updated_at',public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'updated_at',true);
select public.save_supplier_price_decisions(pg_temp.review_payload('{"decision":"keep_imported","note":"Manager checked"}'));
select pg_temp.review_check(jsonb_array_length(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001'))=1,'upsert keeps exactly one row');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'decision'='keep_imported','upsert replaces decision');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'decided_by_name'='Amal Review Manager','latest saver name');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'id'=current_setting('review.previous_id'),'upsert preserves record id');
select pg_temp.review_check((public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'updated_at')::timestamptz>current_setting('review.previous_updated_at')::timestamptz,'updated_at trigger runs');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'updated_by'='19b00000-0000-0000-0000-000000000002','updated_by is authenticated manager');

do $$ declare patch jsonb; begin
 for patch in select value from jsonb_array_elements('[{"decision":"bad"},{"decision":"set_custom"},{"decision":"set_custom","custom_price":-1},{"custom_price":1},{"supplier_price":null},{"supplier_price":"100"},{"imported_price":-1},{"supplier_source_id":"bad"},{"model_code":" "},{"price_field":"bad"},{"currency":"XXX"},{"category":3},{"note":3},{"status":"applied"},{"decided_by":"19b00000-0000-0000-0000-000000000001"}]'::jsonb) loop
  perform pg_temp.review_error(format('select public.save_supplier_price_decisions(pg_temp.review_payload(%L::jsonb))',patch),'22023');
 end loop;
 perform pg_temp.review_error(format('select public.save_supplier_price_decisions(pg_temp.review_payload(%L::jsonb))',jsonb_build_object('note',repeat('x',501))),'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions('{}')$q$,'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions('null')$q$,'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions('[1]')$q$,'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions('[]')$q$,'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions(pg_temp.review_payload('{"supplier_source_id":"19b00000-0000-0000-0002-999999999999"}'))$q$,'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions((select jsonb_agg(pg_temp.review_payload()->0) from generate_series(1,201)))$q$,'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions(pg_temp.review_payload() || pg_temp.review_payload())$q$,'22023');
 -- A bad second row must undo the first row too.
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions(pg_temp.review_payload('{"model_code":"FAKE-19B-ATOMIC"}') || pg_temp.review_payload('{"decision":"bad"}'))$q$,'22023');
 perform pg_temp.review_check(jsonb_array_length(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001'))=1,'invalid batch is atomic');
end $$;
select public.save_supplier_price_decisions(pg_temp.review_payload('{"decision":"set_custom","custom_price":0}'));
select pg_temp.review_check((public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'custom_price')::numeric=0,'zero custom price allowed');
select public.save_supplier_price_decisions(pg_temp.review_payload('{"decision":"check_later"}'));
select public.save_supplier_price_decisions(pg_temp.review_payload('{"decision":"ignore","status":"cancelled"}'));
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'status'='cancelled','Not decided can cancel a saved decision');
select pg_temp.review_as('19b00000-0000-0000-0000-000000000011');
select public.save_supplier_price_decisions(pg_temp.review_payload());
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'decided_by_name'='Team member','blank name never exposes an email');
select pg_temp.review_check(jsonb_array_length(public.save_supplier_price_decisions((select jsonb_agg(pg_temp.review_payload(jsonb_build_object('model_code','FAKE-19B-BULK-'||n))->0) from generate_series(1,200) n)))=200,'exactly 200 distinct decisions accepted');

reset role;
select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
update public.profiles set full_name='review-test-11@example.invalid' where id='19b00000-0000-0000-0000-000000000011';
select pg_temp.review_as('19b00000-0000-0000-0000-000000000011');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'decided_by_name'='Team member','an email stored as full_name is not disclosed');
reset role;
select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
-- Only fake rows are examined; table security/grants are metadata checks.
select pg_temp.review_check((select relrowsecurity from pg_class where oid='public.supplier_price_review_decisions'::regclass),'RLS enabled');
select pg_temp.review_check(not has_table_privilege('authenticated','public.supplier_price_review_decisions','INSERT,UPDATE,DELETE,SELECT'),'no direct table access');
select pg_temp.review_check(not has_function_privilege('anon','public.save_supplier_price_decisions(jsonb)','EXECUTE'),'anon cannot save');
select pg_temp.review_check(not has_function_privilege('anon','public.list_supplier_price_decisions(uuid)','EXECUTE'),'anon cannot list');
select pg_temp.review_check((select count(*)=1 from pg_trigger where tgrelid='public.supplier_price_review_decisions'::regclass and not tgisinternal),'updated_at trigger only, no notifications');
select pg_temp.review_check((select count(*)=1 from public.supplier_price_review_decisions where supplier_source_id='19b00000-0000-0000-0002-000000000001' and model_code='FAKE-19B-A1'),'one current decision');
rollback;
