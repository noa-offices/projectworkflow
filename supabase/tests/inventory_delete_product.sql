-- Self-undoing Task 11 contract. Run manually after the unapplied migration.
begin;
create function pg_temp.check_true(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'Assertion failed: %',message; end if; end $$;
create function pg_temp.expect_error(command text,state text) returns void language plpgsql as $$
begin begin execute command; exception when others then if sqlstate=state then return; end if; raise; end; raise exception 'Expected SQLSTATE %',state; end $$;
insert into auth.users(id,email) values
 ('94000000-0000-0000-0000-000000000001','delete-admin@x.invalid'),('94000000-0000-0000-0000-000000000002','delete-owner@x.invalid'),
 ('94000000-0000-0000-0000-000000000003','delete-worker@x.invalid'),('94000000-0000-0000-0000-000000000004','delete-designer@x.invalid'),('94000000-0000-0000-0000-000000000005','delete-viewer@x.invalid');
insert into public.profiles(id,role,account_status) values
 ('94000000-0000-0000-0000-000000000001','admin_manager','active'),('94000000-0000-0000-0000-000000000002','system_owner','active'),
 ('94000000-0000-0000-0000-000000000003','warehouse_staff','active'),('94000000-0000-0000-0000-000000000004','designer','active'),('94000000-0000-0000-0000-000000000005','viewer','active')
on conflict(id) do update set role=excluded.role,account_status=excluded.account_status;
create temporary table delete_fixture(label text primary key,product_id uuid,request_id uuid,movement_id uuid,reservation_id uuid,movement_request_id uuid);
grant select,update on delete_fixture to authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
do $$ declare label text; result jsonb; pid uuid; rid uuid; mid uuid; qid uuid; hid uuid; begin
 foreach label in array array['target','other','archived'] loop
  result:=inventory.submit_product_request(jsonb_build_object('category_id',(select id from inventory.categories limit 1),'item_name',label,'quantity',5,'costs',jsonb_build_object('price',12)));
  pid:=(result->>'product_id')::uuid;mid:=(select id from inventory.movements where product_id=pid limit 1);
  -- A request photo can remain linked to a request that names its resulting item.
  insert into inventory.product_requests(category_id,item_name,quantity,submitted_by,approved_product_id)
  select category_id,label||' request',1,auth.uid(),pid from inventory.products where id=pid returning id into rid;
  insert into inventory.product_request_costs(product_request_id,price) values(rid,4);
  insert into inventory.product_images(product_id,storage_path,sort_order,is_main) values(pid,label||'/product.webp',0,true);
  insert into inventory.product_images(product_request_id,storage_path,sort_order,is_main) values(rid,label||'/request.jpg',0,true);
  insert into inventory.movement_requests(product_id,request_type,movement_type,quantity,submitted_by,approved_movement_id)
  values(pid,'hold','transfer',1,auth.uid(),mid) returning id into qid;
  insert into inventory.reservations(product_id,kind,quantity,created_by,source_request_id,fulfilled_movement_id)
  values(pid,'hold',1,auth.uid(),qid,mid) returning id into hid;
  update inventory.movement_requests set approved_reservation_id=hid where id=qid;
  insert into delete_fixture values(label,pid,rid,mid,hid,qid);
 end loop;
end $$;
-- A shared object belongs to the other item too; do not return it for Storage deletion.
insert into inventory.product_images(product_id,storage_path,sort_order) select product_id,'other/product.webp',1 from delete_fixture where label='target';
insert into inventory.product_images(product_id,storage_bucket,storage_path,sort_order) select product_id,'another-bucket','not-in-inventory.webp',2 from delete_fixture where label='target';
insert into public.brands(id,name,code) values ('94000000-0000-0000-0000-000000000099','Counter fixture','ZQ9');
insert into inventory.stock_ref_counters(brand_id,last_number) values('94000000-0000-0000-0000-000000000099',42);
create function pg_temp.item_state(pid uuid) returns jsonb language sql as $$
 select jsonb_build_object('product',(select to_jsonb(p) from inventory.products p where p.id=pid),
 'costs',(select jsonb_agg(to_jsonb(c)) from inventory.product_costs c where c.product_id=pid),
 'images',(select jsonb_agg(to_jsonb(i) order by i.id) from inventory.product_images i where i.product_id=pid or i.product_request_id in(select id from inventory.product_requests where approved_product_id=pid)),
 'requests',(select jsonb_agg(to_jsonb(r) order by r.id) from inventory.product_requests r where r.approved_product_id=pid),
 'request_costs',(select jsonb_agg(to_jsonb(c) order by c.product_request_id) from inventory.product_request_costs c where c.product_request_id in(select id from inventory.product_requests where approved_product_id=pid)),
 'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from inventory.movements m where m.product_id=pid),
 'movement_requests',(select jsonb_agg(to_jsonb(r) order by r.id) from inventory.movement_requests r where r.product_id=pid),
 'reservations',(select jsonb_agg(to_jsonb(r) order by r.id) from inventory.reservations r where r.product_id=pid));
$$;
-- Inconsistent cross-item FK links must fail without deleting either item.
update inventory.movement_requests set approved_movement_id=(select movement_id from delete_fixture where label='target') where id=(select movement_request_id from delete_fixture where label='other');
select pg_temp.expect_error(format('select inventory.delete_product_permanently(%L)',(select product_id from delete_fixture where label='target')),'P0001');
update inventory.movement_requests set approved_movement_id=(select movement_id from delete_fixture where label='other') where id=(select movement_request_id from delete_fixture where label='other');
create temporary table delete_owned_requests as select id from inventory.product_requests where approved_product_id=(select product_id from delete_fixture where label='target');
grant select on delete_owned_requests to authenticated;
create temporary table delete_snapshot as select
 pg_temp.item_state((select product_id from delete_fixture where label='other')) as other_state,
 (select jsonb_agg(to_jsonb(c) order by brand_id) from inventory.stock_ref_counters c) as public_counters,
 (select jsonb_agg(to_jsonb(c) order by scope) from inventory.local_stock_ref_counters c) as local_counters,
 (select count(*) from public.notifications) as notifications,
 (select jsonb_agg(to_jsonb(b) order by id) from public.brands b) as brands,
 (select jsonb_agg(to_jsonb(c) order by id) from inventory.categories c) as categories;
select pg_temp.check_true(not has_function_privilege('anon','inventory.delete_product_permanently(uuid)','execute'),'anon cannot execute');
select pg_temp.check_true(not has_function_privilege('service_role','inventory.delete_product_permanently(uuid)','execute'),'only authenticated grant');
select pg_temp.check_true((select count(*)=6 from pg_constraint where contype='f' and confrelid='inventory.products'::regclass),'all six incoming product FKs inspected');
-- Permission checks inside the function, using actual authenticated execution.
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000003',true);
set local role authenticated;
select pg_temp.expect_error(format('select inventory.delete_product_permanently(%L)',(select product_id from delete_fixture where label='target')),'42501');
select pg_temp.expect_error(format('select inventory.get_product_delete_summary(%L)',(select product_id from delete_fixture where label='target')),'42501');
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000004',true);
select pg_temp.expect_error(format('select inventory.delete_product_permanently(%L)',(select product_id from delete_fixture where label='target')),'42501');
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000005',true);
select pg_temp.expect_error(format('select inventory.delete_product_permanently(%L)',(select product_id from delete_fixture where label='target')),'42501');
reset role;
-- Clear the subject before disabling a profile (production profile guard requirement).
select set_config('request.jwt.claim.sub','',true);
update public.profiles set account_status='disabled' where id='94000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select pg_temp.expect_error(format('select inventory.delete_product_permanently(%L)',(select product_id from delete_fixture where label='target')),'42501');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set account_status='active' where id='94000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
-- Unknown future product FKs fail closed, even if CASCADE would otherwise hide them.
create table inventory.future_dependency(product_id uuid references inventory.products(id) on delete cascade);
select pg_temp.expect_error(format('select inventory.delete_product_permanently(%L)',(select product_id from delete_fixture where label='target')),'P0001');
drop table inventory.future_dependency;
-- A failure on the final DELETE must roll back earlier costs/images/history deletes.
create temporary table target_before_failure as select pg_temp.item_state((select product_id from delete_fixture where label='target')) as state;
create function inventory.task11_test_block_delete() returns trigger language plpgsql as $$ begin raise exception 'Fixture final-delete failure'; end $$;
create trigger task11_test_block_delete before delete on inventory.products for each row execute function inventory.task11_test_block_delete();
select pg_temp.expect_error(format('select inventory.delete_product_permanently(%L)',(select product_id from delete_fixture where label='target')),'P0001');
select pg_temp.check_true(pg_temp.item_state((select product_id from delete_fixture where label='target'))=(select state from target_before_failure),'late failure rolls back all owned rows');
drop trigger task11_test_block_delete on inventory.products;
drop function inventory.task11_test_block_delete();
set local role authenticated;
do $$ declare pid uuid; paths text[]; summary jsonb; begin
 pid:=(select product_id from delete_fixture where label='target');
 summary:=inventory.get_product_delete_summary(pid);
 perform pg_temp.check_true((summary->>'photos')::int=4 and (summary->>'movements')::int=1 and (summary->>'reservations')::int=1,'dialog counts include request photos and all history');
 paths:=inventory.delete_product_permanently(pid);
 perform pg_temp.check_true(paths=array['target/product.webp','target/request.jpg'],'only exclusive inventory-images paths returned');
 perform pg_temp.check_true(not exists(select from inventory.products where id=pid),'product deleted');
 perform pg_temp.check_true(not exists(select from inventory.product_costs where product_id=pid),'costs deleted');
 perform pg_temp.check_true(not exists(select from inventory.product_images where product_id=pid or product_request_id=(select request_id from delete_fixture where label='target')),'images deleted');
 perform pg_temp.check_true(not exists(select from inventory.reservations where product_id=pid),'reservations deleted');
 perform pg_temp.check_true(not exists(select from inventory.movements where product_id=pid),'movements deleted');
 perform pg_temp.check_true(not exists(select from inventory.movement_requests where product_id=pid),'movement requests deleted');
 perform pg_temp.check_true(not exists(select from inventory.product_requests where id in(select id from delete_owned_requests)),'all creating requests deleted');
 perform pg_temp.check_true(not exists(select from inventory.product_request_costs where product_request_id=(select request_id from delete_fixture where label='target')),'request costs deleted');
 perform inventory.remove_product((select product_id from delete_fixture where label='archived'),'Archive first');
end $$;
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000002',true);
select pg_temp.check_true(inventory.delete_product_permanently((select product_id from delete_fixture where label='archived'))=array['archived/product.webp','archived/request.jpg'],'owner can delete archived item');
reset role;
select pg_temp.check_true(pg_temp.item_state((select product_id from delete_fixture where label='other'))=(select other_state from delete_snapshot),'other item and all its data unchanged');
select pg_temp.check_true((select jsonb_agg(to_jsonb(c) order by brand_id) from inventory.stock_ref_counters c)=(select public_counters from delete_snapshot),'public counters unchanged');
select pg_temp.check_true((select jsonb_agg(to_jsonb(c) order by scope) from inventory.local_stock_ref_counters c)=(select local_counters from delete_snapshot),'local/GEN counters unchanged');
select pg_temp.check_true((select count(*) from public.notifications)=(select notifications from delete_snapshot),'no notifications');
select pg_temp.check_true((select jsonb_agg(to_jsonb(b) order by id) from public.brands b)=(select brands from delete_snapshot),'brands untouched');
select pg_temp.check_true((select jsonb_agg(to_jsonb(c) order by id) from inventory.categories c)=(select categories from delete_snapshot),'categories untouched');
-- Deletion does not allow a generated reference to be reused.
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare result jsonb; begin
 result:=inventory.submit_product_request(jsonb_build_object('category_id',(select id from inventory.categories limit 1),'item_name','After delete','quantity',1));
 perform pg_temp.check_true((select stock_ref='GEN-0004' from inventory.products where id=(result->>'product_id')::uuid),'deleted generated references never reused');
end $$;
reset role;
rollback;
