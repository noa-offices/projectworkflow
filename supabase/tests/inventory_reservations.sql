-- Run only in a disposable database, after the inventory migrations.
-- psql -X -v ON_ERROR_STOP=1; fixtures and helpers are rolled back.
-- No storage.objects deletes or storage trigger changes.
begin;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
create temporary table inventory_function_actors (
  label text primary key, id uuid not null default gen_random_uuid(),
  role public.user_role not null, status public.account_status not null default 'active'
) on commit drop;
insert into inventory_function_actors(label,role,status) values
 ('system_owner','system_owner','active'), ('admin_manager','admin_manager','active'),
 ('procurement_manager','procurement_manager','active'), ('sales_designer','sales_designer','active'),
 ('sales_coordinator','sales_coordinator','active'), ('designer','designer','active'),
 ('viewer','viewer','active'), ('warehouse_staff','warehouse_staff','active'),
 ('pending','warehouse_staff','pending'), ('disabled','admin_manager','disabled');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select id,id::text || '@inventory-functions.invalid','{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb from inventory_function_actors;
insert into public.profiles(id,email,full_name,role,account_status)
select id,id::text || '@inventory-functions.invalid',label,role,status from inventory_function_actors
on conflict(id) do update set role=excluded.role,account_status=excluded.account_status;
create temporary table inventory_function_fixture on commit drop as
select gen_random_uuid() brand_id, gen_random_uuid() category_id, gen_random_uuid() product_id,
  'inventory-functions-' || gen_random_uuid()::text marker;
insert into public.brands(id,name) select brand_id,marker from inventory_function_fixture;
insert into inventory.categories(id,name,slug) select category_id,marker,marker from inventory_function_fixture;
insert into inventory.products(id,brand_id,category_id,stock_ref,item_code,item_name,model_name,quantity,warehouse_quantity)
select product_id,brand_id,category_id,marker,marker,marker,marker,20,20 from inventory_function_fixture;
grant select on inventory_function_actors,inventory_function_fixture to authenticated;

create function pg_temp.inventory_function_expect_error(command text, expected_state text, message_part text default '')
returns void language plpgsql security invoker as $$
begin
  begin
    execute command;
  exception when others then
    if sqlstate = expected_state and position(message_part in sqlerrm) > 0 then return; end if;
    raise;
  end;
  raise exception 'Expected % error: %',expected_state,command;
end $$;
create function pg_temp.inventory_function_assert(ok boolean, message text)
returns void language plpgsql security invoker as $$
begin
  if ok is distinct from true then raise exception 'Assertion failed: %',message; end if;
end $$;
create function pg_temp.inventory_function_stock(product_id uuid, expected integer[])
returns void language plpgsql security invoker as $$
declare actual integer[];
begin
  select array[p.warehouse_quantity,p.dubai_showroom_quantity,p.abudhabi_showroom_quantity,
    p.mockup_quantity,p.temporary_out_quantity,p.sold_quantity,p.quantity] into actual
  from inventory.products p where p.id=product_id;
  perform pg_temp.inventory_function_assert(actual=expected,'Stock buckets: ' || coalesce(actual::text,'missing'));
end $$;
create function pg_temp.inventory_function_movement(movement_id uuid, action text, previous integer, next_quantity integer)
returns void language plpgsql security invoker as $$
begin
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.movements m
    where m.id=movement_id and m.action_type=action and m.previous_quantity=previous and m.new_quantity=next_quantity
    and m.created_by=auth.uid() and m.movement_type=(case action when 'receive_stock' then 'stock_in'
      when 'sale' then 'stock_out' when 'adjustment' then 'adjustment' else 'transfer' end)::inventory.inventory_movement_type),'Movement audit');
end $$;

set local role authenticated;
do $$ declare f record; result jsonb; r uuid; req uuid; begin
 select * into f from inventory_function_fixture;
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='admin_manager'),true);
 result:=inventory.submit_movement_request(f.product_id,'book','sale',null,null,15,null,null,'Client reference',null);
 r:=(result->>'reservation_id')::uuid;
 perform pg_temp.inventory_function_assert(inventory.reserved_quantity(f.product_id)=15,'Manager booking immediate');
 perform pg_temp.inventory_function_expect_error(format('select inventory.record_direct_movement(%L,''sale'',''warehouse'',null,6,null)',f.product_id),'P0001','Only 5 units are available; 15 are reserved');
 perform pg_temp.inventory_function_expect_error(format('select inventory.record_direct_movement(%L,''adjustment'',null,null,14,null)',f.product_id),'P0001','Release reservations first');
 perform inventory.fulfil_reservation(r,'sale','warehouse',null,'Delivered');
 perform pg_temp.inventory_function_assert(inventory.reserved_quantity(f.product_id)=0,'Fulfilled excluded');
 perform pg_temp.inventory_function_assert((select quantity=5 from inventory.products where id=f.product_id),'Fulfil reserved stock');
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='designer'),true);
 result:=inventory.submit_movement_request(f.product_id,'hold','sale',null,null,3,null);
 req:=(result->>'request_id')::uuid;
 perform pg_temp.inventory_function_assert(inventory.reserved_quantity(f.product_id)=0,'Pending does not reserve');
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='admin_manager'),true);
 perform inventory.review_movement_request(req,'approved',null);
 select approved_reservation_id into r from inventory.movement_requests where id=req;
 perform pg_temp.inventory_function_assert(inventory.reserved_quantity(f.product_id)=3,'Approval reserves');
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='sales_designer'),true);
 perform pg_temp.inventory_function_expect_error(format('select inventory.release_reservation(%L,null)',r),'42501','permission');
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='designer'),true);
 perform inventory.release_reservation(r,'No longer needed');
 perform pg_temp.inventory_function_assert(inventory.reserved_quantity(f.product_id)=0,'Creator release');
end $$;
-- Synthetic expired rows exercise the read-time availability predicate without sleeping.
reset role;
insert into inventory.reservations(product_id,kind,quantity,expires_at,created_by)
select product_id,'hold',2,now()-interval '1 minute',(select id from inventory_function_actors where label='designer') from inventory_function_fixture;
insert into public.clients(id,company_name) values('11111111-1111-1111-1111-111111111111','Client');
insert into public.projects(id,client_id,project_number,project_name,is_active) values
 ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','001','Visible',true),
 ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','002','Archived',false);
set local role authenticated;
do $$ declare f record; result jsonb; r uuid; stale uuid; actor record; begin
 select * into f from inventory_function_fixture;
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='designer'),true);
 perform pg_temp.inventory_function_assert(inventory.reserved_quantity(f.product_id)=0,'Expired, released and fulfilled excluded');
 perform pg_temp.inventory_function_expect_error(format('select inventory.submit_movement_request(%L,''book'',''sale'',null,null,1,null)',f.product_id),'P0001','project or reference');
 perform pg_temp.inventory_function_expect_error(format('select inventory.submit_movement_request(%L,''hold'',''sale'',null,null,1,null,null,null,now()-interval ''1 day'')',f.product_id),'P0001','future');
 perform pg_temp.inventory_function_expect_error(format('select inventory.submit_movement_request(%L,''book'',''sale'',null,null,1,null,''33333333-3333-3333-3333-333333333333'')',f.product_id),'42501','accessible');
 result:=inventory.submit_movement_request(f.product_id,'book','sale',null,null,1,null,'22222222-2222-2222-2222-222222222222');
 perform pg_temp.inventory_function_assert((select project_label='001 - Visible - Client' from inventory.movement_requests where id=(result->>'request_id')::uuid),'Project snapshot');
 result:=inventory.submit_movement_request(f.product_id,'hold','sale',null,null,4,null);
 stale:=(result->>'request_id')::uuid;
 for actor in select * from inventory_function_actors loop
   perform set_config('request.jwt.claim.sub',actor.id::text,true);
   if actor.role in ('procurement_manager','sales_designer','sales_coordinator','designer') and actor.status='active' then
     result:=inventory.submit_movement_request(f.product_id,'hold','sale',null,null,1,null);
     perform pg_temp.inventory_function_assert(result->>'reservation_id' is null,'Requester awaits approval');
     result:=inventory.submit_movement_request(f.product_id,'book','sale',null,null,1,null,null,'Reference');
     perform pg_temp.inventory_function_assert(result->>'reservation_id' is null,'Book awaits approval');
   elsif actor.role not in ('system_owner','admin_manager') or actor.status<>'active' then
     perform pg_temp.inventory_function_expect_error(format('select inventory.submit_movement_request(%L,''hold'',''sale'',null,null,1,null)',f.product_id),'42501','permission');
   end if;
 end loop;
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='admin_manager'),true);
 result:=inventory.submit_movement_request(f.product_id,'hold','sale',null,null,4,null);
 r:=(result->>'reservation_id')::uuid;
 perform pg_temp.inventory_function_expect_error(format('select inventory.fulfil_reservation(%L,''sale'',''dubai_showroom'',null,null)',r),'P0001','Only 0 units');
 perform pg_temp.inventory_function_assert(inventory.reserved_quantity(f.product_id)=4,'Failed fulfil rolls back reservation state');
 perform pg_temp.inventory_function_expect_error(format('select inventory.record_direct_movement(%L,''internal_transfer'',''warehouse'',''mockup'',2,null)',f.product_id),'P0001','Only 1 units are available; 4 are reserved');
 perform pg_temp.inventory_function_expect_error(format('select inventory.review_movement_request(%L,''approved'',null)',stale),'P0001','Only 1 units are available; 4 are reserved');
 perform pg_temp.inventory_function_assert((select request_status='pending_review' from inventory.movement_requests where id=stale),'Stale approval rollback');
 perform pg_temp.inventory_function_assert(not has_table_privilege('authenticated','inventory.reservations','insert'),'No direct reservation writes');
 perform pg_temp.inventory_function_assert(not has_function_privilege('authenticated','inventory.create_request_reservation(uuid)','execute'),'Reservation helper internal');
end $$;
reset role; rollback;
