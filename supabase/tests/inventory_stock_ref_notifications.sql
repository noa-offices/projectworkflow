-- Disposable-database assertions for inventory notifications. Everything is rolled back.
begin;
create function pg_temp.check_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',message; end if; end $$;
create function pg_temp.n(rcpt uuid, pat text) returns int language sql as $$
 select count(*)::int from public.notifications where recipient_id=rcpt and body like pat;
$$;
insert into auth.users(id,email) values
 ('80000000-0000-0000-0000-000000000001','n-admin@x.invalid'),('80000000-0000-0000-0000-000000000002','n-owner@x.invalid'),
 ('80000000-0000-0000-0000-000000000003','n-off@x.invalid'),('80000000-0000-0000-0000-000000000004','n-wh@x.invalid'),
 ('80000000-0000-0000-0000-000000000005','n-design@x.invalid');
insert into public.profiles(id,full_name,role,account_status) values
 ('80000000-0000-0000-0000-000000000001','Admin Anna','admin_manager','active'),
 ('80000000-0000-0000-0000-000000000002','Owner Omar','system_owner','active'),
 ('80000000-0000-0000-0000-000000000003','Disabled Dan','admin_manager','disabled'),
 ('80000000-0000-0000-0000-000000000004','Ware Wally','warehouse_staff','active'),
 ('80000000-0000-0000-0000-000000000005','Design Dina','sales_designer','active')
on conflict (id) do update set full_name=excluded.full_name, role=excluded.role, account_status=excluded.account_status;
insert into public.brands(id,name,code) values ('81000000-0000-0000-0000-000000000001','Notify Brand','NTF');
create temporary table nfix(category_id uuid, product_id uuid, stock_ref text, preq uuid, mreq uuid, mreq2 uuid);
insert into nfix(category_id) select id from inventory.categories limit 1;
grant select,update on nfix to authenticated;

-- 1. Manager adds an item directly: nobody is notified.
select set_config('request.jwt.claim.sub','80000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare r jsonb; begin
 r:=inventory.submit_product_request(jsonb_build_object('brand_id','81000000-0000-0000-0000-000000000001','category_id',(select category_id from nfix),'item_name','Direct Chair','quantity',3,'initial_stock',jsonb_build_object('warehouse',3)));
 update nfix set product_id=(r->>'product_id')::uuid;
end $$;
reset role;
update nfix set stock_ref=(select p.stock_ref from inventory.products p where p.id=nfix.product_id);
select pg_temp.check_true((select count(*) from public.notifications where recipient_id::text like '80000000%')=0,'manager own request notifies nobody');

-- 2. Warehouse staff requests a new item: both active managers hear, not the disabled one, not the sender.
select set_config('request.jwt.claim.sub','80000000-0000-0000-0000-000000000004',true);
set local role authenticated;
do $$ declare r jsonb; begin
 r:=inventory.submit_product_request(jsonb_build_object('brand_id','81000000-0000-0000-0000-000000000001','category_id',(select category_id from nfix),'item_name',E'Line\nBreak Table','quantity',1));
 update nfix set preq=(r->>'request_id')::uuid;
end $$;
reset role;
select pg_temp.check_true(pg_temp.n('80000000-0000-0000-0000-000000000001','New item request: Line Break Table%Ref assigned on approval from Ware Wally')=1,'admin notified');
select pg_temp.check_true(pg_temp.n('80000000-0000-0000-0000-000000000002','New item request: Line Break Table%Ref assigned on approval from Ware Wally')=1,'owner notified');
select pg_temp.check_true(pg_temp.n('80000000-0000-0000-0000-000000000003','%')=0,'disabled manager not notified');
select pg_temp.check_true(pg_temp.n('80000000-0000-0000-0000-000000000004','%')=0,'sender not notified');
select pg_temp.check_true(exists(select from public.notifications where recipient_id='80000000-0000-0000-0000-000000000001' and order_no='/inventory/requests?tab=products&status=pending_review' and sent_to_role='inventory_managers' and sender_id='80000000-0000-0000-0000-000000000004'),'link, role and sender set');

-- 3. Designer asks to hold / book: managers hear.
select set_config('request.jwt.claim.sub','80000000-0000-0000-0000-000000000005',true);
set local role authenticated;
do $$ declare r jsonb; begin
 r:=inventory.submit_movement_request((select product_id from nfix),'hold','sale',null,null,1,null);
 update nfix set mreq=(r->>'request_id')::uuid;
 r:=inventory.submit_movement_request((select product_id from nfix),'hold','sale',null,null,1,null);
 update nfix set mreq2=(r->>'request_id')::uuid;
end $$;
reset role;
select pg_temp.check_true(pg_temp.n('80000000-0000-0000-0000-000000000001','Hold request: Direct Chair%' || (select stock_ref from nfix) || ' x1 from Design Dina')=2,'admin notified of hold requests');
select pg_temp.check_true(exists(select from public.notifications where recipient_id='80000000-0000-0000-0000-000000000002' and order_no='/inventory/requests?tab=movements&status=pending_review'),'movement link');
select pg_temp.check_true(pg_temp.n('80000000-0000-0000-0000-000000000005','%')=0,'designer not notified of own request');

-- 4. Decisions: requester hears; reviewer does not.
select set_config('request.jwt.claim.sub','80000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ begin
 perform inventory.review_movement_request((select mreq from nfix),'approved','Go ahead');
 perform inventory.review_movement_request((select mreq2 from nfix),'rejected','No stock');
 perform inventory.review_product_request((select preq from nfix),'rejected','Duplicate item');
end $$;
reset role;
select pg_temp.check_true(pg_temp.n('80000000-0000-0000-0000-000000000005','Your hold request for Direct Chair%' || (select stock_ref from nfix) || ' was approved: Go ahead')=1,'designer told approved');
select pg_temp.check_true(pg_temp.n('80000000-0000-0000-0000-000000000005','Your hold request for Direct Chair%' || (select stock_ref from nfix) || ' was rejected: No stock')=1,'designer told rejected');
select pg_temp.check_true(pg_temp.n('80000000-0000-0000-0000-000000000004','Your request for Line Break Table%Ref assigned on approval was rejected: Duplicate item')=1,'warehouse told rejected');
select pg_temp.check_true(exists(select from public.notifications where recipient_id='80000000-0000-0000-0000-000000000004' and order_no='/inventory/requests?tab=products&status=rejected'),'decision link');
select pg_temp.check_true(pg_temp.n('80000000-0000-0000-0000-000000000001','Your %')=0,'reviewer not told of own decision');

-- 5. Safety: no costs or emails in any body, and trigger functions are locked.
select pg_temp.check_true(not exists(select from public.notifications where recipient_id::text like '80000000%' and (body ~* 'cost|price|@')),'no costs or emails in bodies');
select pg_temp.check_true(not has_function_privilege('authenticated','inventory.notify_new_product_request()','EXECUTE')
 and not has_function_privilege('anon','inventory.notify_new_movement_request()','EXECUTE')
 and not has_function_privilege('authenticated','inventory.notify_product_request_decided()','EXECUTE')
 and not has_function_privilege('authenticated','inventory.notify_movement_request_decided()','EXECUTE'),'trigger functions locked');

-- A new request has a pending label; approval uses the actual generated GEN ref.
select set_config('request.jwt.claim.sub','80000000-0000-0000-0000-000000000004',true);
set local role authenticated;
do $$ declare r jsonb; begin
 r:=inventory.submit_product_request(jsonb_build_object('category_id',(select category_id from nfix),'item_name','Generic Chair','item_code','1234','model_name','X','quantity',1));
 update nfix set preq=(r->>'request_id')::uuid;
end $$;
reset role;
select pg_temp.check_true(pg_temp.n('80000000-0000-0000-0000-000000000001','%Ref assigned on approval · Code 1234 · Model X%')=1,'pending optional identifiers');
select set_config('request.jwt.claim.sub','80000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ begin perform inventory.review_product_request((select preq from nfix),'approved',null); end $$;
reset role;
select pg_temp.check_true(pg_temp.n('80000000-0000-0000-0000-000000000004','Your request for Generic Chair%GEN-% · Code 1234 · Model X was approved')=1,'approved canonical Stock ref');
select pg_temp.check_true(not exists(select from public.notifications where body like '%—%' or body like '%· ·%'),'no empty separators');

-- 6. A notification failure never breaks a request.
alter table public.notifications add constraint nfail check (body = 'never') not valid;
select set_config('request.jwt.claim.sub','80000000-0000-0000-0000-000000000004',true);
set local role authenticated;
do $$ declare r jsonb; begin
 r:=inventory.submit_product_request(jsonb_build_object('brand_id','81000000-0000-0000-0000-000000000001','category_id',(select category_id from nfix),'item_name','Survives','quantity',1));
 perform pg_temp.check_true(r->>'request_id' is not null,'request still saved when notification fails');
end $$;
reset role;
select 'ALL NOTIFICATION TESTS PASSED' as result;
rollback;
