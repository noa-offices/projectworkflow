-- Disposable-database contract assertions. All fixtures and writes are rolled back.
begin;
create function pg_temp.check_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',message; end if; end $$;
create function pg_temp.expect_error(command text, message text) returns void language plpgsql as $$
begin
 begin execute command; exception when others then
  if position(message in sqlerrm)>0 then return; end if; raise;
 end;
 raise exception 'Expected error containing %',message;
end $$;
insert into auth.users(id,email) values ('70000000-0000-0000-0000-000000000001','manager@stock.invalid'),('70000000-0000-0000-0000-000000000002','warehouse@stock.invalid');
insert into public.profiles(id,role,account_status) values ('70000000-0000-0000-0000-000000000001','admin_manager','active'),('70000000-0000-0000-0000-000000000002','warehouse_staff','active');
insert into public.brands(id,name,code) values
 ('71000000-0000-0000-0000-000000000001','Stock A','AAA'),('71000000-0000-0000-0000-000000000002','Stock B','BBB'),
 ('71000000-0000-0000-0000-000000000003','Stock missing',null),('71000000-0000-0000-0000-000000000004','Stock blank','  ');
create temporary table stock_fixture(category_id uuid, request_id uuid, product_id uuid);
insert into stock_fixture(category_id) select id from inventory.categories limit 1;
grant select,update on stock_fixture to authenticated;
create function pg_temp.payload(brand text default '71000000-0000-0000-0000-000000000001') returns jsonb language sql as $$
 select jsonb_build_object('brand_id',brand,'category_id',(select category_id from stock_fixture),'item_name','Chair','quantity',2);
$$;
select set_config('request.jwt.claim.sub','70000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$ declare result jsonb; begin
 result:=inventory.submit_product_request(pg_temp.payload()||'{"stock_ref":{"spoof":true},"item_code":"  ","model_name":"  "}');
 update stock_fixture set request_id=(result->>'request_id')::uuid;
 perform pg_temp.check_true(result->>'product_id' is null,'warehouse pending result');
 perform pg_temp.check_true((select stock_ref is null and item_code is null and model_name is null from inventory.product_requests where id=(result->>'request_id')::uuid),'pending ignores spoof; optional fields normalized');
 perform pg_temp.expect_error('select inventory.next_stock_ref(''71000000-0000-0000-0000-000000000001'')','permission denied');
 perform pg_temp.expect_error('select * from inventory.stock_ref_counters','permission denied');
end $$;
reset role;
select pg_temp.check_true(not exists(select from inventory.stock_ref_counters),'submit consumes no counter');
select pg_temp.check_true((select relrowsecurity from pg_class where oid='inventory.stock_ref_counters'::regclass),'counter RLS');
select pg_temp.check_true(not has_table_privilege('anon','inventory.stock_ref_counters','SELECT') and not has_table_privilege('authenticated','inventory.stock_ref_counters','INSERT'),'counter privileges');
select pg_temp.check_true(not has_function_privilege('anon','inventory.next_stock_ref(uuid)','EXECUTE') and not has_function_privilege('authenticated','inventory.next_stock_ref(uuid)','EXECUTE'),'helper privileges');
insert into inventory.product_images(product_request_id,storage_path,sort_order,is_main)
select request_id,'stock-ref-test/photo.png',0,true from stock_fixture;
select set_config('request.jwt.claim.sub','70000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare p uuid; r jsonb; begin
 p:=inventory.review_product_request_with_edits((select request_id from stock_fixture),'approved',null,'{"stock_ref":["bad"],"item_code":" ","model_name":" ","initial_stock":{"dubai_showroom":2}}');
 update stock_fixture set product_id=p;
 perform pg_temp.check_true(exists(select from inventory.product_images where product_id=p and product_request_id is null and storage_path='stock-ref-test/photo.png'),'photos relinked');
 perform pg_temp.check_true(exists(select from inventory.movements where product_id=p and action_type='receive_stock' and to_location='dubai_showroom' and quantity=2),'initial stock movement audit');
 perform pg_temp.check_true((select stock_ref='AAA-0001' and item_code is null and model_name is null and quantity=2 and dubai_showroom_quantity=2 and warehouse_quantity=0 from inventory.products where id=p),'first approval generates ref and saves optional fields and stock');
 perform pg_temp.check_true((select stock_ref='AAA-0001' from inventory.product_requests where id=(select request_id from stock_fixture)),'generated ref persisted on request');
 r:=inventory.submit_product_request(pg_temp.payload()||'{"stock_ref":"","item_code":"UNIQUE","model_name":"M","costs":{"price":12}}');
 perform pg_temp.check_true((select stock_ref='AAA-0002' from inventory.products where id=(r->>'product_id')::uuid),'manager direct second ref');
 perform pg_temp.check_true((select price=12 from inventory.product_costs where product_id=(r->>'product_id')::uuid),'direct costs preserved');
 r:=inventory.submit_product_request(pg_temp.payload('71000000-0000-0000-0000-000000000002')||'{"stock_ref":false}');
 perform pg_temp.check_true((select stock_ref='BBB-0001' from inventory.products where id=(r->>'product_id')::uuid),'separate brand counter');
 perform pg_temp.expect_error(format('select inventory.submit_product_request(%L::jsonb)',pg_temp.payload()||'{"item_code":"UNIQUE"}'),'item code already in use');
 perform inventory.update_product(p,'{"item_code":" ","model_name":" ","stock_ref":"MANUAL-REF"}');
 perform pg_temp.check_true((select item_code is null and model_name is null and stock_ref='MANUAL-REF' from inventory.products where id=p),'metadata normalizes blanks and permits existing ref editing');
 perform pg_temp.expect_error(format('select inventory.submit_product_request(%L::jsonb)',pg_temp.payload('71000000-0000-0000-0000-000000000003')),'Brand needs a code');
 perform pg_temp.expect_error(format('select inventory.submit_product_request(%L::jsonb)',pg_temp.payload('71000000-0000-0000-0000-000000000004')),'Brand needs a code');
end $$;
reset role;
select pg_temp.check_true((select last_number=2 from inventory.stock_ref_counters where brand_id='71000000-0000-0000-0000-000000000001'),'failed approvals roll back counter');
select pg_temp.check_true(not exists(select from inventory.stock_ref_counters where brand_id in ('71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000004')),'missing codes roll back');
-- Active legacy collisions are case-insensitive and untouched.
insert into inventory.products(brand_id,category_id,stock_ref,item_name)
select '71000000-0000-0000-0000-000000000001',category_id,'aaa-0003','Legacy' from stock_fixture;
set local role authenticated;
do $$ declare r jsonb; begin
 r:=inventory.submit_product_request(pg_temp.payload());
 perform pg_temp.check_true((select stock_ref='AAA-0004' from inventory.products where id=(r->>'product_id')::uuid),'skip active legacy collision');
end $$;
reset role;
update inventory.stock_ref_counters set last_number=9999 where brand_id='71000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ declare r jsonb; begin
 r:=inventory.submit_product_request(pg_temp.payload('71000000-0000-0000-0000-000000000002'));
 perform pg_temp.check_true((select stock_ref='BBB-10000' from inventory.products where id=(r->>'product_id')::uuid),'digits grow after 9999');
end $$;
-- Rejection never allocates a number, even if the brand has no code.
select set_config('request.jwt.claim.sub','70000000-0000-0000-0000-000000000002',true);
update stock_fixture set request_id=(inventory.submit_product_request(pg_temp.payload('71000000-0000-0000-0000-000000000003'))->>'request_id')::uuid;
select set_config('request.jwt.claim.sub','70000000-0000-0000-0000-000000000001',true);
select inventory.review_product_request((select request_id from stock_fixture),'rejected','Rejected');
reset role;
select pg_temp.check_true(not exists(select from inventory.stock_ref_counters where brand_id='71000000-0000-0000-0000-000000000003'),'reject consumes no number');
select pg_temp.expect_error(format('update inventory.product_requests set stock_ref='' '' where id=%L',(select request_id from stock_fixture)),'product_requests_stock_ref_not_blank');
-- Failed review leaves the original pending request, photos and counter intact; retry reuses the number.
select set_config('request.jwt.claim.sub','70000000-0000-0000-0000-000000000002',true);
set local role authenticated;
update stock_fixture set request_id=(inventory.submit_product_request(pg_temp.payload()||'{"item_code":"UNIQUE"}')->>'request_id')::uuid;
reset role;
insert into inventory.product_images(product_request_id,storage_path,sort_order,is_main)
select request_id,'stock-ref-test/retry.png',0,true from stock_fixture;
select set_config('request.jwt.claim.sub','70000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select pg_temp.expect_error(format('select inventory.review_product_request(%L,''approved'',null)',(select request_id from stock_fixture)),'item code already in use');
reset role;
select pg_temp.check_true((select last_number=4 from inventory.stock_ref_counters where brand_id='71000000-0000-0000-0000-000000000001'),'failed review consumes no number');
select pg_temp.check_true((select request_status='pending_review' and stock_ref is null and approved_product_id is null from inventory.product_requests where id=(select request_id from stock_fixture)),'failed review leaves request pending');
select pg_temp.check_true(exists(select from inventory.product_images where product_request_id=(select request_id from stock_fixture) and product_id is null),'failed review leaves photo attached');
set local role authenticated;
do $$ declare p uuid; begin
 p:=inventory.review_product_request_with_edits((select request_id from stock_fixture),'approved',null,'{"item_code":null,"model_name":null,"stock_ref":"browser-spoof"}');
 perform pg_temp.check_true((select stock_ref='AAA-0005' and item_code is null and model_name is null from inventory.products where id=p),'retry reuses next number');
end $$;
reset role;
rollback;
