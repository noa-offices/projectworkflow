-- Run BEFORE applying Task 20. This script rolls back both schema and fixtures.
begin;
-- Task 20: manual application only. No rows are deleted or hidden by RLS.
drop policy if exists product_requests_select on inventory.product_requests;
create policy product_requests_select on inventory.product_requests for select to authenticated
using (inventory.can_manage() or (inventory.can_view() and submitted_by = (select auth.uid())));
drop policy if exists movement_requests_select on inventory.movement_requests;
create policy movement_requests_select on inventory.movement_requests for select to authenticated
using (inventory.can_manage() or (inventory.can_view() and submitted_by = (select auth.uid())));
drop policy if exists movements_select on inventory.movements;
create policy movements_select on inventory.movements for select to authenticated using (inventory.can_manage());

-- Request photos are private. Product-linked photos remain visible to inventory viewers.
drop policy if exists product_images_select on inventory.product_images;
create policy product_images_select on inventory.product_images for select to authenticated
using (inventory.can_manage() or (inventory.can_view() and (
 product_id is not null or exists (select 1 from inventory.product_requests r
 where r.id=product_images.product_request_id and r.submitted_by=(select auth.uid()))
)));
-- Allow product paths, own request paths (including before metadata insert), and
-- product-linked images that retain their original request path after approval.
drop policy if exists inventory_images_select on storage.objects;
create policy inventory_images_select on storage.objects for select to authenticated
using (bucket_id='inventory-images' and (inventory.can_manage() or (inventory.can_view() and (
 (storage.foldername(name))[1]='products'
 or exists (select 1 from inventory.product_requests r where r.id::text=(storage.foldername(name))[2]
   and (storage.foldername(name))[1]='requests' and r.submitted_by=(select auth.uid()))
 or exists (select 1 from inventory.product_images i where i.storage_bucket=objects.bucket_id
   and i.storage_path=objects.name and i.product_id is not null)
))));

-- Restrictive because existing permissive policies include a sales-coordinator policy.
-- Inventory activity contains actor names, request details and movements.
create policy task20_inventory_activity_manager_only on public.audit_activity_log
as restrictive for select to authenticated
using (entity_type not like 'inventory\_%' escape '\' or inventory.can_manage());

-- Senders who are managers retain their sent-notification read status view.
drop policy if exists "Senders can select notifications they sent" on public.notifications;
create policy "Senders can select notifications they sent" on public.notifications for select to authenticated
using (sender_id = (select auth.uid()) and inventory.can_manage());

alter table inventory.product_requests
 add column cleared_at timestamptz,
 add column cleared_by uuid references public.profiles(id) on delete set null,
 add constraint product_requests_pending_not_cleared check (request_status <> 'pending_review' or cleared_at is null);
alter table inventory.movement_requests
 add column cleared_at timestamptz,
 add column cleared_by uuid references public.profiles(id) on delete set null,
 add constraint movement_requests_pending_not_cleared check (request_status <> 'pending_review' or cleared_at is null);

create or replace function inventory.person_names(p_ids uuid[])
returns table (id uuid, full_name text) language plpgsql stable security definer set search_path = '' as $$
begin
 if not coalesce(inventory.can_view(), false) then raise exception 'Inventory access denied' using errcode='42501'; end if;
 if coalesce(cardinality(p_ids),0)>200 then raise exception 'At most 200 ids per call' using errcode='22023'; end if;
 return query select p.id,p.full_name from public.profiles p
 where p.id=any(p_ids) and (p.id=auth.uid() or (inventory.can_manage() and (inventory.is_record_actor(p.id)
 or exists(select 1 from inventory.product_requests r where r.cleared_by=p.id)
 or exists(select 1 from inventory.movement_requests r where r.cleared_by=p.id))));
end $$;
revoke all on function inventory.person_names(uuid[]) from public,anon,authenticated,service_role;
grant execute on function inventory.person_names(uuid[]) to authenticated;

create or replace function inventory.search_people(term text)
returns table (id uuid) language plpgsql stable security definer set search_path = '' as $$
declare needle text := btrim(coalesce(term,''));
begin
 if not coalesce(inventory.can_manage(),false) then raise exception 'Inventory management permission required' using errcode='42501'; end if;
 if char_length(needle)<2 then return; end if;
 needle := replace(replace(replace(needle, chr(92), chr(92)||chr(92)), '%', chr(92)||'%'), '_', chr(92)||'_');
 return query select p.id from public.profiles p where p.full_name ilike '%'||needle||'%' escape chr(92)
 and inventory.is_record_actor(p.id) order by p.id limit 100;
end $$;
revoke all on function inventory.search_people(text) from public,anon,authenticated,service_role;
grant execute on function inventory.search_people(text) to authenticated;

create function inventory.clear_finished_requests(p_kind text, p_before timestamptz default null)
returns table(product_count bigint, movement_count bigint) language plpgsql security definer set search_path = '' as $$
declare a bigint := 0; b bigint := 0;
begin
 if auth.uid() is null or not coalesce(inventory.can_manage(),false) then raise exception 'Inventory management permission required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('product','movement','all') then raise exception 'Invalid request kind' using errcode='22023'; end if;
 if p_kind in ('product','all') then
  update inventory.product_requests set cleared_at=now(),cleared_by=auth.uid()
  where request_status in ('approved','rejected') and cleared_at is null and (p_before is null or reviewed_at<=p_before);
  get diagnostics a = row_count;
 end if;
 if p_kind in ('movement','all') then
  update inventory.movement_requests set cleared_at=now(),cleared_by=auth.uid()
  where request_status in ('approved','rejected') and cleared_at is null and (p_before is null or reviewed_at<=p_before);
  get diagnostics b = row_count;
 end if;
 return query select a,b;
end $$;
create function inventory.restore_cleared_requests(p_kind text)
returns table(product_count bigint, movement_count bigint) language plpgsql security definer set search_path = '' as $$
declare a bigint := 0; b bigint := 0;
begin
 if auth.uid() is null or not coalesce(inventory.can_manage(),false) then raise exception 'Inventory management permission required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('product','movement','all') then raise exception 'Invalid request kind' using errcode='22023'; end if;
 if p_kind in ('product','all') then update inventory.product_requests set cleared_at=null,cleared_by=null where cleared_at is not null; get diagnostics a = row_count; end if;
 if p_kind in ('movement','all') then update inventory.movement_requests set cleared_at=null,cleared_by=null where cleared_at is not null; get diagnostics b = row_count; end if;
 return query select a,b;
end $$;
create function inventory.restore_cleared_request(p_kind text,p_id uuid)
returns table(product_count bigint, movement_count bigint) language plpgsql security definer set search_path = '' as $$
declare a bigint := 0; b bigint := 0;
begin
 if auth.uid() is null or not coalesce(inventory.can_manage(),false) then raise exception 'Inventory management permission required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('product','movement') or p_id is null then raise exception 'Invalid request kind or id' using errcode='22023'; end if;
 if p_kind='product' then update inventory.product_requests set cleared_at=null,cleared_by=null where id=p_id and cleared_at is not null; get diagnostics a = row_count;
 else update inventory.movement_requests set cleared_at=null,cleared_by=null where id=p_id and cleared_at is not null; get diagnostics b = row_count; end if;
 return query select a,b;
end $$;
revoke all on function inventory.clear_finished_requests(text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function inventory.restore_cleared_requests(text) from public,anon,authenticated,service_role;
revoke all on function inventory.restore_cleared_request(text,uuid) from public,anon,authenticated,service_role;
grant execute on function inventory.clear_finished_requests(text,timestamptz) to authenticated;
grant execute on function inventory.restore_cleared_requests(text) to authenticated;
grant execute on function inventory.restore_cleared_request(text,uuid) to authenticated;

-- Task 20 after-apply contract: all fixtures and changes roll back.

create function pg_temp.check_true(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'Assertion failed: %',msg; end if; end $$;
create function pg_temp.expect_error(cmd text, state text) returns void language plpgsql as $$ begin begin execute cmd; exception when others then if sqlstate=state then return; end if; raise; end; raise exception 'Expected SQLSTATE %', state; end $$;
create function pg_temp.act_as(uid text) returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub',uid,true); execute 'set local role authenticated'; end $$;
insert into auth.users(id,email) select ('97000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'task20-'||n||'@invalid.test' from generate_series(1,12) n on conflict (id) do update set email=excluded.email;
insert into public.profiles(id,email,full_name,role,account_status)
select ('97000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'task20-'||n||'@invalid.test','Task20 '||n,
 (array['system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','viewer','warehouse_staff','admin_manager','admin_manager'])[n]::public.user_role,
 (case when n=9 then 'disabled' when n=10 then 'pending' else 'active' end)::public.account_status from generate_series(1,10) n
on conflict (id) do update set email=excluded.email,full_name=excluded.full_name,role=excluded.role,account_status=excluded.account_status;
insert into public.brands(id,name,code) values ('97100000-0000-0000-0000-000000000001','Task20','T20') on conflict (id) do update set name=excluded.name;
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000002',true);
create temporary table t20_product(id uuid); grant select on t20_product to authenticated;
insert into t20_product select (inventory.submit_product_request(jsonb_build_object('brand_id','97100000-0000-0000-0000-000000000001','category_id',(select id from inventory.categories limit 1),'item_name','Task20 product','quantity',10,'initial_stock',jsonb_build_object('warehouse',10)))->>'product_id')::uuid;
insert into inventory.product_requests(id,category_id,item_name,quantity,submitted_by,request_status,reviewed_by,reviewed_at)
select ('97200000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,(select id from inventory.categories limit 1),'Task20 request',1,
 ('97000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,(case n%3 when 0 then 'pending_review' when 1 then 'approved' else 'rejected' end)::inventory.product_request_status,
 '97000000-0000-0000-0000-000000000002',now()-interval '60 days' from generate_series(1,8) n;
insert into inventory.movement_requests(id,product_id,request_type,movement_type,quantity,submitted_by,request_status,reviewed_by,reviewed_at)
select ('97300000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,(select id from t20_product),'hold','transfer',1,
 ('97000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,(case n%3 when 0 then 'pending_review' when 1 then 'approved' else 'rejected' end)::inventory.product_request_status,
 '97000000-0000-0000-0000-000000000002',now()-interval '60 days' from generate_series(1,8) n;
do $$ declare n int; uid text; expected int; begin
 for n in 1..11 loop
 uid := '97000000-0000-0000-0000-'||lpad(n::text,12,'0'); perform pg_temp.act_as(uid);
 expected := case when n<=2 then 8 when n<=8 then 1 else 0 end;
 perform pg_temp.check_true((select count(*) from inventory.product_requests where id::text like '97200000-%')=expected,'product ownership role '||n);
 perform pg_temp.check_true((select count(*) from inventory.movement_requests where id::text like '97300000-%')=expected,'movement request ownership role '||n);
 perform pg_temp.check_true((select count(*) from inventory.movements where product_id=(select id from t20_product))=case when n<=2 then 1 else 0 end,'movements role '||n);
 if n between 3 and 8 then
   perform pg_temp.check_true(not exists(select from inventory.product_requests where id='97200000-0000-0000-0000-000000000001'),'ID access denied');
   perform pg_temp.check_true((select count(*) from inventory.person_names(array[uid::uuid,'97000000-0000-0000-0000-000000000002'::uuid]))=1,'only own name');
   perform pg_temp.expect_error($c$select * from inventory.search_people('Task20')$c$,'42501');
 end if;
 if n>2 then
   perform pg_temp.expect_error($c$select * from inventory.clear_finished_requests('all')$c$,'42501');
   perform pg_temp.expect_error($c$select * from inventory.restore_cleared_requests('all')$c$,'42501');
   perform pg_temp.expect_error($c$select * from inventory.restore_cleared_request('product','97200000-0000-0000-0000-000000000001')$c$,'42501');
 end if;
 end loop; execute 'reset role'; end $$;
create temporary table t20_notification_snapshot as select count(*) n from public.notifications where recipient_id::text like '97000000-%'; grant select on t20_notification_snapshot to authenticated;
select pg_temp.act_as('97000000-0000-0000-0000-000000000002');
select pg_temp.check_true((select count(*) from inventory.person_names(array['97000000-0000-0000-0000-000000000003'::uuid,'97000000-0000-0000-0000-000000000004'::uuid]))=2,'manager names');
select pg_temp.expect_error($c$select * from inventory.clear_finished_requests('invalid')$c$,'22023');
select pg_temp.expect_error($c$update inventory.product_requests set cleared_at=now() where id='97200000-0000-0000-0000-000000000003'$c$,'23514');
select pg_temp.expect_error($c$update inventory.movement_requests set cleared_at=now() where id='97300000-0000-0000-0000-000000000003'$c$,'23514');
select pg_temp.check_true((select product_count>=0 and movement_count>=0 from inventory.clear_finished_requests('all',now()-interval '90 days')),'cutoff excludes recent');
select pg_temp.check_true(not exists(select from inventory.product_requests where id::text like '97200000-%' and cleared_at is not null),'cutoff leaves fake rows alone');
select pg_temp.check_true((select product_count>=6 and movement_count=0 from inventory.clear_finished_requests('product',now()-interval '30 days')),'product scope and cutoff');
select pg_temp.check_true((select movement_count>=6 and product_count=0 from inventory.clear_finished_requests('movement')),'movement scope');
select pg_temp.check_true(not exists(select from inventory.product_requests where id::text like '97200000-%' and request_status='pending_review' and cleared_at is not null),'pending product untouched');
select pg_temp.check_true(not exists(select from inventory.movement_requests where id::text like '97300000-%' and request_status='pending_review' and cleared_at is not null),'pending movement untouched');
select pg_temp.check_true(exists(select from inventory.product_requests where id='97200000-0000-0000-0000-000000000001' and cleared_at is not null and submitted_by is not null and reviewed_by is not null),'attribution retained');
select pg_temp.check_true((select product_count=1 and movement_count=0 from inventory.restore_cleared_request('product','97200000-0000-0000-0000-000000000001')),'individual restore');
select pg_temp.check_true((select product_count>=5 and movement_count>=6 from inventory.restore_cleared_requests('all')),'restore all');
select pg_temp.check_true((select product_count>=6 and movement_count>=6 from inventory.clear_finished_requests('all')),'clear both');
select pg_temp.check_true((select product_count>=6 and movement_count=0 from inventory.restore_cleared_requests('product')),'restore product only');
select pg_temp.check_true((select product_count=0 and movement_count>=6 from inventory.restore_cleared_requests('movement')),'restore movement only');
reset role;
select pg_temp.check_true((select count(*) from public.notifications where recipient_id::text like '97000000-%')=(select n from t20_notification_snapshot),'archive and restore do not notify');
select pg_temp.act_as('97000000-0000-0000-0000-000000000001');
select pg_temp.check_true((select product_count>=0 and movement_count>=0 from inventory.clear_finished_requests('all',now()-interval '1000 years')),'owner can clear');
select pg_temp.act_as('97000000-0000-0000-0000-000000000002');
select pg_temp.check_true((select quantity=10 from inventory.products where id=(select id from t20_product)) and (select count(*)=1 from inventory.movements where product_id=(select id from t20_product)),'stock and movements unchanged');
-- Request paths remain available for the authorized warehouse and sales roles.
create temporary table t20_submissions(kind text,id uuid); grant select,insert on t20_submissions to authenticated;
select pg_temp.act_as('97000000-0000-0000-0000-000000000008');
insert into t20_submissions select 'product',(inventory.submit_product_request(jsonb_build_object('category_id',(select id from inventory.categories limit 1),'item_name','Task20 warehouse request','quantity',1))->>'request_id')::uuid;
insert into t20_submissions select 'product_approve',(inventory.submit_product_request(jsonb_build_object('category_id',(select id from inventory.categories limit 1),'item_name','Task20 approval request','quantity',1))->>'request_id')::uuid;
insert into t20_submissions select 'take',(inventory.submit_movement_request((select id from t20_product),'take','sale','warehouse',null,1,null)->>'request_id')::uuid;
do $$ declare n int; uid text; begin
 for n in 3..6 loop
  uid := '97000000-0000-0000-0000-'||lpad(n::text,12,'0'); perform pg_temp.act_as(uid);
  insert into t20_submissions select 'hold',(inventory.submit_movement_request((select id from t20_product),'hold','sale',null,null,1,null)->>'request_id')::uuid;
  insert into t20_submissions select 'book',(inventory.submit_movement_request((select id from t20_product),'book','sale',null,null,1,null,null,'Task20 reference')->>'request_id')::uuid;
 end loop; execute 'reset role'; end $$;
select pg_temp.act_as('97000000-0000-0000-0000-000000000002');
select inventory.review_product_request((select id from t20_submissions where kind='product'),'rejected','Task20 reject');
select inventory.review_product_request((select id from t20_submissions where kind='product_approve'),'approved','Task20 approve');
select pg_temp.check_true(exists(select from inventory.product_requests where id=(select id from t20_submissions where kind='product_approve') and request_status='approved' and approved_product_id is not null),'manager approved product');
select inventory.review_movement_request((select id from t20_submissions where kind='hold' limit 1),'approved','Task20 approve');
select inventory.review_movement_request((select id from t20_submissions where kind='book' limit 1),'rejected','Task20 reject');
select pg_temp.check_true(exists(select from inventory.reservations where source_request_id in (select id from t20_submissions where kind='hold')),'approved hold creates reservation');
reset role;
insert into inventory.product_requests(id,category_id,item_name,quantity,submitted_by,request_status)
select ('97500000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,(select id from inventory.categories limit 1),'Task20 direct update',1,('97000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'approved' from generate_series(3,8) n;
insert into inventory.movement_requests(id,product_id,request_type,movement_type,quantity,submitted_by,request_status)
select ('97600000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,(select id from t20_product),'hold','transfer',1,('97000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'approved' from generate_series(3,8) n;
insert into inventory.product_requests(id,category_id,item_name,quantity,submitted_by)
select ('97700000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,(select id from inventory.categories limit 1),'Task20 pending update',1,('97000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid from generate_series(3,8) n;
insert into inventory.movement_requests(id,product_id,request_type,movement_type,quantity,submitted_by)
select ('97800000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,(select id from t20_product),'hold','transfer',1,('97000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid from generate_series(3,8) n;
do $$ declare n int; a int; b int; begin
 for n in 3..8 loop
  perform pg_temp.act_as('97000000-0000-0000-0000-'||lpad(n::text,12,'0'));
  update inventory.product_requests set cleared_at=now() where id=('97500000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid; get diagnostics a=row_count;
  update inventory.movement_requests set cleared_at=now() where id=('97600000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid; get diagnostics b=row_count;
  perform pg_temp.check_true(a=0 and b=0,'non-manager own-row update blocked role '||n);
  update inventory.product_requests set cleared_at=now() where id=('97700000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid; get diagnostics a=row_count;
  update inventory.movement_requests set cleared_at=now() where id=('97800000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid; get diagnostics b=row_count;
  perform pg_temp.check_true(a=0 and b=0,'non-manager pending update blocked role '||n);
 end loop; execute 'reset role'; end $$;
select pg_temp.act_as('97000000-0000-0000-0000-000000000004');
update inventory.product_requests set cleared_at=now() where id='97200000-0000-0000-0000-000000000004';
update inventory.movement_requests set cleared_at=now() where id='97300000-0000-0000-0000-000000000004';
reset role;
select pg_temp.check_true(not exists(select from inventory.product_requests where id='97200000-0000-0000-0000-000000000004' and cleared_at is not null) and not exists(select from inventory.movement_requests where id='97300000-0000-0000-0000-000000000004' and cleared_at is not null),'non-manager cannot archive');
select pg_temp.check_true((select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute')) from unnest(array['inventory.clear_finished_requests(text,timestamptz)','inventory.restore_cleared_requests(text)','inventory.restore_cleared_request(text,uuid)']) f),'all RPC grants restricted');
-- Existing permissive coordinator policy cannot bypass the restrictive inventory activity policy.
insert into public.audit_activity_log(entity_type,action,title) values ('inventory_request','task20','Task20 private activity'),('task20_other','task20','Task20 unrelated activity');
select pg_temp.act_as('97000000-0000-0000-0000-000000000005');
select pg_temp.check_true(not exists(select from public.audit_activity_log where title='Task20 private activity') and exists(select from public.audit_activity_log where title='Task20 unrelated activity'),'activity restrictive policy');
select pg_temp.act_as('97000000-0000-0000-0000-000000000002');
select pg_temp.check_true(exists(select from public.audit_activity_log where title='Task20 private activity'),'manager sees activity');
reset role;
-- A manager recorded only as clearer is still available for attribution.
reset role;
insert into public.profiles(id,email,full_name,role,account_status) values ('97000000-0000-0000-0000-000000000012','task20-12@invalid.test','Clearer Only','admin_manager','active')
on conflict (id) do update set email=excluded.email,full_name=excluded.full_name,role=excluded.role,account_status=excluded.account_status;
update inventory.product_requests set cleared_at=now(),cleared_by='97000000-0000-0000-0000-000000000012' where id='97200000-0000-0000-0000-000000000001';
select pg_temp.act_as('97000000-0000-0000-0000-000000000002');
select pg_temp.check_true(exists(select from inventory.person_names(array['97000000-0000-0000-0000-000000000012'::uuid]) where full_name='Clearer Only'),'clear-only manager name');
reset role;
update inventory.product_requests set cleared_at=null,cleared_by=null where id='97200000-0000-0000-0000-000000000001';
update inventory.movement_requests set cleared_at=now(),cleared_by='97000000-0000-0000-0000-000000000012' where id='97300000-0000-0000-0000-000000000001';
select pg_temp.act_as('97000000-0000-0000-0000-000000000002');
select pg_temp.check_true(exists(select from inventory.person_names(array['97000000-0000-0000-0000-000000000012'::uuid]) where full_name='Clearer Only'),'movement-only clearer name');
reset role;
-- Request photos and object paths are private; linked product photos remain visible even on request paths.
insert into inventory.product_images(id,product_request_id,storage_path,uploaded_by) values
 ('97400000-0000-0000-0000-000000000001','97200000-0000-0000-0000-000000000006','requests/97200000-0000-0000-0000-000000000006/private.jpg','97000000-0000-0000-0000-000000000006');
insert into inventory.product_images(id,product_id,storage_path,uploaded_by) values
 ('97400000-0000-0000-0000-000000000002',(select id from t20_product),'requests/97200000-0000-0000-0000-000000000001/relinked.jpg','97000000-0000-0000-0000-000000000002');
insert into storage.objects(bucket_id,name) values
 ('inventory-images','requests/97200000-0000-0000-0000-000000000006/private.jpg'),
 ('inventory-images','requests/97200000-0000-0000-0000-000000000006/before-metadata.jpg'),
 ('inventory-images','requests/97200000-0000-0000-0000-000000000001/relinked.jpg'),
 ('inventory-images','requests/97200000-0000-0000-0000-000000000001/unlinked.jpg');
select pg_temp.act_as('97000000-0000-0000-0000-000000000005');
select pg_temp.check_true(not exists(select from inventory.product_images where id='97400000-0000-0000-0000-000000000001') and exists(select from inventory.product_images where id='97400000-0000-0000-0000-000000000002'),'private request metadata and visible product metadata');
select pg_temp.check_true(not exists(select from storage.objects where name like '%/private.jpg' or name like '%/unlinked.jpg') and exists(select from storage.objects where name like '%/relinked.jpg'),'private objects and relinked product object');
select pg_temp.act_as('97000000-0000-0000-0000-000000000006');
select pg_temp.check_true(exists(select from inventory.product_images where id='97400000-0000-0000-0000-000000000001') and (select count(*) from storage.objects where name like '%/private.jpg' or name like '%/before-metadata.jpg')=2,'owner can read request photos and pre-metadata object');
select pg_temp.act_as('97000000-0000-0000-0000-000000000002');
select pg_temp.check_true((select count(*) from storage.objects where name like 'requests/97200000-0000-0000-0000-000000000001/%' or name like 'requests/97200000-0000-0000-0000-000000000006/%')=4,'manager sees all objects');
reset role;
-- Recipient policy remains intact; managers retain sender visibility, other senders do not.
insert into public.notifications(recipient_id,sender_id,body) values
 ('97000000-0000-0000-0000-000000000004','97000000-0000-0000-0000-000000000003','Task20 sender privacy'),
 ('97000000-0000-0000-0000-000000000004','97000000-0000-0000-0000-000000000002','Task20 manager sender');
select pg_temp.act_as('97000000-0000-0000-0000-000000000003');
select pg_temp.check_true(not exists(select from public.notifications where body='Task20 sender privacy'),'nonmanager sender cannot see another recipient');
select pg_temp.act_as('97000000-0000-0000-0000-000000000004');
select pg_temp.check_true((select count(*) from public.notifications where body in ('Task20 sender privacy','Task20 manager sender'))=2,'recipient sees own notifications');
select pg_temp.act_as('97000000-0000-0000-0000-000000000002');
select pg_temp.check_true(exists(select from public.notifications where body='Task20 manager sender'),'manager retains sender access');
reset role;
select set_config('request.jwt.claim.sub','',true);
select 'ALL TASK 20 TESTS PASSED' as result;
rollback;
