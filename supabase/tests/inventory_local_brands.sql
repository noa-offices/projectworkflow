-- Self-undoing contract: run after the Task 10a migration.
begin;
create function pg_temp.check_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',message; end if; end $$;
create function pg_temp.expect_error(command text, expected_state text) returns void language plpgsql as $$
begin
 begin execute command; exception when others then if sqlstate=expected_state then return; end if; raise; end;
 raise exception 'Expected SQLSTATE %',expected_state;
end $$;
insert into public.brands(id,name,code) values ('72000000-0000-0000-0000-000000000001','Existing brand','OLD');
create temporary table brand_fixture(local_id uuid, product_id uuid, request_id uuid, public_count bigint);
insert into brand_fixture(public_count) select count(*) from public.brands;
grant select,update on brand_fixture to authenticated;
insert into auth.users(id,email) values ('73000000-0000-0000-0000-000000000001','manager@brands.invalid'),('73000000-0000-0000-0000-000000000002','worker@brands.invalid');
insert into public.profiles(id,role,account_status) values ('73000000-0000-0000-0000-000000000001','admin_manager','active'),('73000000-0000-0000-0000-000000000002','warehouse_staff','active');
create function pg_temp.payload() returns jsonb language sql as $$ select jsonb_build_object('category_id',(select id from inventory.categories limit 1),'item_name','Brand test','quantity',1) $$;
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select pg_temp.expect_error($q$select inventory.create_local_brand('Shop','SHP')$q$,'42501');
select pg_temp.expect_error('select * from inventory.local_brands','42501');
select pg_temp.expect_error($q$select inventory.rename_local_brand(gen_random_uuid(),'Bad')$q$,'42501');
select pg_temp.expect_error($q$select inventory.deactivate_local_brand(gen_random_uuid())$q$,'42501');
reset role;
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-000000000001',true);
set local role authenticated;
update brand_fixture set local_id=inventory.create_local_brand(' Shop ','shp');
select pg_temp.expect_error($q$select inventory.create_local_brand('shop','SH2')$q$,'23505');
select pg_temp.expect_error($q$select inventory.create_local_brand('Other','ShP')$q$,'23505');
select pg_temp.expect_error($q$select inventory.create_local_brand('Other','OLD')$q$,'23505');
select pg_temp.expect_error($q$select inventory.create_local_brand('Other','GEN')$q$,'23514');
select pg_temp.expect_error($q$select inventory.create_local_brand('Other','A-')$q$,'23514');
do $$ declare r jsonb; p uuid; begin
 r:=inventory.submit_product_request(pg_temp.payload()||'{"brand_id":"72000000-0000-0000-0000-000000000001"}');
 perform pg_temp.check_true((select stock_ref='OLD-0001' from inventory.products where id=(r->>'product_id')::uuid),'public ref');
 r:=inventory.submit_product_request(pg_temp.payload()||jsonb_build_object('local_brand_id',(select local_id from brand_fixture)));
 p:=(r->>'product_id')::uuid; update brand_fixture set product_id=p;
 perform pg_temp.check_true((select stock_ref='SHP-0001' and brand_id is null from inventory.products where id=p),'local ref');
 r:=inventory.submit_product_request(pg_temp.payload());
 perform pg_temp.check_true((select stock_ref='GEN-0001' and brand_id is null and local_brand_id is null from inventory.products where id=(r->>'product_id')::uuid),'no brand ref');
 perform pg_temp.expect_error(format('select inventory.submit_product_request(%L::jsonb)',pg_temp.payload()||jsonb_build_object('brand_id','72000000-0000-0000-0000-000000000001','local_brand_id',(select local_id from brand_fixture))),'23514');
 perform pg_temp.expect_error(format('select inventory.update_product(%L,%L::jsonb)',p,jsonb_build_object('brand_id','72000000-0000-0000-0000-000000000001','local_brand_id',(select local_id from brand_fixture))),'23514');
 perform inventory.update_product(p,'{"brand_id":null,"local_brand_id":null}');
 perform pg_temp.check_true((select stock_ref='SHP-0001' and local_brand_id is null from inventory.products where id=p),'edit retains ref');
 perform inventory.update_product(p,jsonb_build_object('local_brand_id',(select local_id from brand_fixture)));
 perform inventory.rename_local_brand((select local_id from brand_fixture),'Renamed shop');
 perform set_config('request.jwt.claim.sub','73000000-0000-0000-0000-000000000002',true);
 r:=inventory.submit_product_request(pg_temp.payload()||jsonb_build_object('local_brand_id',(select local_id from brand_fixture)));
 update brand_fixture set request_id=(r->>'request_id')::uuid;
 perform pg_temp.check_true(r->>'product_id' is null,'worker stays pending');
 perform set_config('request.jwt.claim.sub','73000000-0000-0000-0000-000000000001',true);
 perform inventory.deactivate_local_brand((select local_id from brand_fixture));
 perform pg_temp.expect_error(format('select inventory.review_product_request_with_edits(%L,''approved'',null,''{}'')',(select request_id from brand_fixture)),'23514');
 perform inventory.review_product_request_with_edits((select request_id from brand_fixture),'approved',null,'{"brand_id":null,"local_brand_id":null}');

 perform pg_temp.check_true(not exists(select from inventory.list_local_brands() b where b.id=(select local_id from brand_fixture)),'inactive omitted from picker');
 perform pg_temp.check_true(exists(select from inventory.read_local_brand_names() b where b.id=(select local_id from brand_fixture) and b.name='Renamed shop'),'old label remains readable');
 perform pg_temp.expect_error(format('select inventory.submit_product_request(%L::jsonb)',pg_temp.payload()||jsonb_build_object('local_brand_id',(select local_id from brand_fixture))),'23514');
 perform inventory.update_product(p,'{"note":"Existing inactive brand stays"}');
end $$;
reset role;
-- Case-insensitive collision skipping for the no-brand sequence.
insert into inventory.products(category_id,stock_ref,item_name) select id,'gen-0003','Legacy generic ref' from inventory.categories limit 1;
set local role authenticated;
do $$ declare r jsonb; begin
 r:=inventory.submit_product_request(pg_temp.payload());
 perform pg_temp.check_true((select stock_ref='GEN-0004' from inventory.products where id=(r->>'product_id')::uuid),'no-brand skips legacy collision');
end $$;
reset role;
-- Every active viewer can list; none of the nonmanager roles can manage.
do $$ declare v_role public.user_role; v_id uuid; begin
 foreach v_role in array array['system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','viewer','warehouse_staff']::public.user_role[] loop
  v_id:=gen_random_uuid(); insert into auth.users(id) values(v_id); insert into public.profiles(id,role,account_status) values(v_id,v_role,'active');
  perform set_config('request.jwt.claim.sub',v_id::text,true);
  perform inventory.list_local_brands(); perform inventory.read_local_brand_names();
  if v_role not in ('system_owner','admin_manager') then
   perform pg_temp.expect_error($q$select inventory.create_local_brand('Forbidden','BAD')$q$,'42501');
   perform pg_temp.expect_error($q$select inventory.rename_local_brand(gen_random_uuid(),'Bad')$q$,'42501');
   perform pg_temp.expect_error($q$select inventory.deactivate_local_brand(gen_random_uuid())$q$,'42501');
  end if;
  update public.profiles set account_status='disabled' where id=v_id;
  perform pg_temp.expect_error('select inventory.list_local_brands()','42501');
  perform pg_temp.expect_error('select inventory.read_local_brand_names()','42501');
 end loop;
end $$;
select pg_temp.check_true((select last_number=1 from inventory.stock_ref_counters where brand_id='72000000-0000-0000-0000-000000000001'),'local and no-brand never change public counter');
select pg_temp.check_true((select count(*) from public.brands)=(select public_count from brand_fixture),'public brands unchanged');
select pg_temp.check_true((select relrowsecurity from pg_class where oid='inventory.local_brands'::regclass),'RLS enabled');
select pg_temp.expect_error(format('delete from inventory.local_brands where id=%L',(select local_id from brand_fixture)),'23001');
rollback;
