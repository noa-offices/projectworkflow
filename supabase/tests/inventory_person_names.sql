-- Self-undoing Task 16 contract. Run manually after the unapplied migration 20261027100000_inventory_person_names.sql.
begin;
create function pg_temp.check_true(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'Assertion failed: %',message; end if; end $$;
create function pg_temp.expect_error(command text,state text) returns void language plpgsql as $$
begin begin execute command; exception when others then if sqlstate=state then return; end if; raise; end; raise exception 'Expected SQLSTATE %',state; end $$;

-- 1 owner, 2 admin, 3 procurement, 4 sales manager, 5 coordinator, 6 designer, 7 viewer, 8 warehouse, 9 no activity, 10 disabled
insert into auth.users(id,email) values
 ('96000000-0000-0000-0000-000000000001','names-owner@x.invalid'),('96000000-0000-0000-0000-000000000002','names-admin@x.invalid'),
 ('96000000-0000-0000-0000-000000000003','names-procurement@x.invalid'),('96000000-0000-0000-0000-000000000004','names-sales@x.invalid'),
 ('96000000-0000-0000-0000-000000000005','names-coordinator@x.invalid'),('96000000-0000-0000-0000-000000000006','names-designer@x.invalid'),
 ('96000000-0000-0000-0000-000000000007','names-viewer@x.invalid'),('96000000-0000-0000-0000-000000000008','names-warehouse@x.invalid'),
 ('96000000-0000-0000-0000-000000000009','names-nobody@x.invalid'),('96000000-0000-0000-0000-000000000010','names-disabled@x.invalid');
insert into public.profiles(id,email,full_name,role,account_status) values
 ('96000000-0000-0000-0000-000000000001','names-owner@x.invalid','Olivia Owner','system_owner','active'),
 ('96000000-0000-0000-0000-000000000002','names-admin@x.invalid','Amal Admin','admin_manager','active'),
 ('96000000-0000-0000-0000-000000000003','names-procurement@x.invalid','Priya Procurement','procurement_manager','active'),
 ('96000000-0000-0000-0000-000000000004','names-sales@x.invalid','Sana Sales 100%','sales_designer','active'),
 ('96000000-0000-0000-0000-000000000005','names-coordinator@x.invalid','Chris Coordinator','sales_coordinator','active'),
 ('96000000-0000-0000-0000-000000000006','names-designer@x.invalid','Dina Designer','designer','active'),
 ('96000000-0000-0000-0000-000000000007','names-viewer@x.invalid','Victor Viewer','viewer','active'),
 ('96000000-0000-0000-0000-000000000008','names-warehouse@x.invalid','Subair Warehouse','warehouse_staff','active'),
 ('96000000-0000-0000-0000-000000000009','names-nobody@x.invalid','Nobody Nolan','viewer','active'),
 ('96000000-0000-0000-0000-000000000010','names-disabled@x.invalid','Dora Disabled','designer','active')
on conflict(id) do update set email=excluded.email,full_name=excluded.full_name,role=excluded.role,account_status=excluded.account_status;

-- Inventory activity: admin creates an item (product + movement), the warehouse worker requests an item that the owner reviews,
-- the designer requests a movement that the admin reviews, the sales manager holds stock.
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000002',true);
create temporary table names_fixture(product_id uuid);
grant select on names_fixture to authenticated;
insert into names_fixture select (inventory.submit_product_request(jsonb_build_object('category_id',(select id from inventory.categories limit 1),'item_name','Names fixture','quantity',3,'costs',jsonb_build_object('price',1)))->>'product_id')::uuid;
insert into inventory.product_requests(category_id,item_name,quantity,submitted_by,reviewed_by)
 select category_id,'Worker request',1,'96000000-0000-0000-0000-000000000008','96000000-0000-0000-0000-000000000001' from inventory.products limit 1;
insert into inventory.movement_requests(product_id,request_type,movement_type,quantity,submitted_by,reviewed_by)
 select product_id,'hold','transfer',1,'96000000-0000-0000-0000-000000000006','96000000-0000-0000-0000-000000000002' from names_fixture;
insert into inventory.reservations(product_id,kind,quantity,created_by)
 select product_id,'hold',1,'96000000-0000-0000-0000-000000000004' from names_fixture;

-- Helpers. Profiles are not readable by the caller, so ids are passed explicitly.
create function pg_temp.ids_all() returns uuid[] language sql as $$ select array(select ('96000000-0000-0000-0000-0000000000'||lpad(n::text,2,'0'))::uuid from generate_series(1,10) n) $$;
create function pg_temp.act_as(uid text) returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub',uid,true); execute 'set local role authenticated'; end $$;

-- All 8 roles can look up and search. Only the 5 people with Inventory activity come back (admin, owner, worker, designer, sales).
do $$ declare uid text; names text[]; found uuid[]; begin
 foreach uid in array array['96000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000003','96000000-0000-0000-0000-000000000004',
  '96000000-0000-0000-0000-000000000005','96000000-0000-0000-0000-000000000006','96000000-0000-0000-0000-000000000007','96000000-0000-0000-0000-000000000008'] loop
  perform pg_temp.act_as(uid);
  select array_agg(full_name order by full_name) into names from inventory.person_names(pg_temp.ids_all());
  perform pg_temp.check_true(names = array['Amal Admin','Dina Designer','Olivia Owner','Sana Sales 100%','Subair Warehouse'],'person_names for '||uid||': '||coalesce(names::text,'null'));
  -- A worker asking about a manager and a manager asking about a worker are both covered by the loop (warehouse = ...08, admin = ...02).
  select array_agg(id) into found from inventory.search_people('amal');
  perform pg_temp.check_true(found = array['96000000-0000-0000-0000-000000000002'::uuid],'search amal for '||uid);
  select array_agg(id) into found from inventory.search_people('SUBAIR');
  perform pg_temp.check_true(found = array['96000000-0000-0000-0000-000000000008'::uuid],'search is case-insensitive for '||uid);
 end loop;
 execute 'reset role';
end $$;

-- Only id and full_name are ever returned (no email, phone, role, avatar or status).
select pg_temp.act_as('96000000-0000-0000-0000-000000000008');
select pg_temp.check_true((select array_agg(k order by k) from (select distinct jsonb_object_keys(to_jsonb(t)) k from inventory.person_names(pg_temp.ids_all()) t) q)=array['full_name','id'],'person_names columns');
select pg_temp.check_true(not exists(select 1 from inventory.search_people('a')),'one-character search returns nothing');
select pg_temp.check_true(pg_get_function_result('inventory.search_people(text)'::regprocedure)='TABLE(id uuid)' and pg_get_function_result('inventory.person_names(uuid[])'::regprocedure)='TABLE(id uuid, full_name text)','return shapes: only id (+ full_name)');
select pg_temp.check_true(not exists(select 1 from inventory.person_names(pg_temp.ids_all()) where full_name like '%@%'),'no email in names');

-- A person with no Inventory activity is not returned and cannot be found by name.
select pg_temp.check_true(not exists(select 1 from inventory.person_names(array['96000000-0000-0000-0000-000000000009'::uuid])),'no-activity person is hidden');
select pg_temp.check_true(not exists(select 1 from inventory.search_people('nobody')),'no-activity person is not searchable');
select pg_temp.check_true(not exists(select 1 from inventory.person_names(array['96000000-0000-0000-0000-000000000007'::uuid])),'viewer without activity is hidden');

-- Wildcards are literal: % and _ never match everything, but a literal % in a real name still works.
select pg_temp.check_true(not exists(select 1 from inventory.search_people('%%')),'%% matches nothing');
select pg_temp.check_true(not exists(select 1 from inventory.search_people('__')),'__ matches nothing');
select pg_temp.check_true(not exists(select 1 from inventory.search_people('a%')),'a% matches nothing');
select pg_temp.check_true((select array_agg(id) from inventory.search_people('100%'))=array['96000000-0000-0000-0000-000000000004'::uuid],'literal % in a name');
select pg_temp.check_true(not exists(select 1 from inventory.search_people(null)),'null term');

-- More than 200 ids is refused.
select pg_temp.expect_error('select * from inventory.person_names(array(select gen_random_uuid() from generate_series(1,201)))','22023');

-- Disabled users and anon are refused. Clear the claim before disabling the user.
select pg_temp.act_as('96000000-0000-0000-0000-000000000001');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set account_status='disabled' where id='96000000-0000-0000-0000-000000000010';
select pg_temp.act_as('96000000-0000-0000-0000-000000000010');
select pg_temp.expect_error('select * from inventory.person_names(pg_temp.ids_all())','42501');
select pg_temp.expect_error($c$select * from inventory.search_people('amal')$c$,'42501');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.expect_error('select * from inventory.person_names(array[gen_random_uuid()])','42501');
select pg_temp.expect_error($c$select * from inventory.search_people('amal')$c$,'42501');
reset role;

-- Grants: authenticated only, and public.profiles policies are not part of this change.
select pg_temp.check_true(has_function_privilege('authenticated','inventory.person_names(uuid[])','execute') and has_function_privilege('authenticated','inventory.search_people(text)','execute'),'authenticated can execute');
select pg_temp.check_true(not has_function_privilege('anon','inventory.person_names(uuid[])','execute') and not has_function_privilege('service_role','inventory.person_names(uuid[])','execute')
 and not has_function_privilege('anon','inventory.search_people(text)','execute') and not has_function_privilege('service_role','inventory.search_people(text)','execute'),'anon and service_role cannot execute');
select pg_temp.check_true(not has_function_privilege('authenticated','inventory.is_record_actor(uuid)','execute'),'helper is internal');
rollback;
