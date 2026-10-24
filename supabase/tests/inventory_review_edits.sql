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
do $$ declare f record; r uuid; p uuid; begin
 select * into f from inventory_function_fixture;
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='warehouse_staff'),true);
 r:=inventory.submit_product_request(jsonb_build_object('brand_id',f.brand_id,'category_id',f.category_id,'stock_ref',f.marker||'r','item_code',f.marker||'r','item_name','Chair','model_name','M','quantity',7,'initial_stock',jsonb_build_object('warehouse',3,'dubai_showroom',4)));
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='admin_manager'),true);
 perform pg_temp.inventory_function_expect_error(format('select inventory.review_product_request_with_edits(%L,''approved'',null,''{"quantity":8}''::jsonb)',r),'23514','initial_stock');
 perform pg_temp.inventory_function_expect_error(format('select inventory.review_product_request_with_edits(%L,''approved'',null,''{"item_name":""}''::jsonb)',r),'P0001','required');
 p:=inventory.review_product_request_with_edits(r,'approved','Checked','{"item_name":"Edited","costs":{"price":12},"initial_stock":{"mockup":7}}');
 perform pg_temp.inventory_function_assert((select item_name='Edited' and mockup_quantity=7 and quantity=7 from inventory.products where id=p),'Edited fields and buckets');
 perform pg_temp.inventory_function_assert((select price=12 from inventory.product_costs where product_id=p),'Costs copied');
 perform pg_temp.inventory_function_assert((select to_location='mockup' from inventory.movements where product_id=p),'Actual destination audit');
 perform pg_temp.inventory_function_expect_error(format('select inventory.review_product_request(%L,''approved'',null)',r),'P0001','already');
 perform pg_temp.inventory_function_assert(not inventory.valid_initial_stock('{"warehouse":1.5}',1),'Reject fractions');
end $$;
do $$ declare f record; r uuid; p uuid; begin
 select * into f from inventory_function_fixture;
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='warehouse_staff'),true);
 r:=inventory.submit_product_request(jsonb_build_object('brand_id',f.brand_id,'category_id',f.category_id,'stock_ref',f.marker||'reject','item_code',f.marker||'reject','item_name','Chair','model_name','M','quantity',2));
 perform pg_temp.inventory_function_expect_error(format('select inventory.review_product_request_with_edits(%L,''approved'',null,''{}'')',r),'42501','permission');
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='admin_manager'),true);
 perform inventory.review_product_request_with_edits(r,'rejected','Declined','null');
 perform pg_temp.inventory_function_assert((select request_status='rejected' from inventory.product_requests where id=r),'Reject ignores invalid edits');
 perform pg_temp.inventory_function_assert(not inventory.valid_initial_stock('{"unknown":2}',2),'Unknown bucket');
 perform pg_temp.inventory_function_assert(not inventory.valid_initial_stock('{"warehouse":-1}',-1),'Negative bucket');
 perform pg_temp.inventory_function_assert(not inventory.valid_initial_stock('{"warehouse":"2"}',2),'String bucket');
 perform pg_temp.inventory_function_assert(not inventory.valid_initial_stock('[]',0),'Array');
 perform pg_temp.inventory_function_assert(not has_function_privilege('authenticated','inventory.apply_stock_change(uuid,text,text,text,integer,text,text,uuid,uuid)','execute'),'Stock writer remains internal');
end $$;
do $$ declare f record; r uuid; p uuid; photo uuid; begin
 select * into f from inventory_function_fixture;
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='admin_manager'),true);
 r:=inventory.submit_product_request(jsonb_build_object('brand_id',f.brand_id,'category_id',f.category_id,'stock_ref',f.marker||'multi','item_code',f.marker||'multi','item_name','Chair','model_name','M','quantity',3,'initial_stock','{"warehouse":1,"temporary_out":2}'::jsonb,'costs','{"price":10,"freight_cost":2}'::jsonb));
 insert into inventory.product_images(product_request_id,storage_path,is_main,uploaded_by) values(r,'requests/'||r::text||'/photo.jpg',true,auth.uid()) returning id into photo;
 p:=inventory.review_product_request_with_edits(r,'approved','Checked','{"quantity":4,"initial_stock":{"warehouse":2,"temporary_out":2},"costs":{"price":12}}');
 perform pg_temp.inventory_function_assert((select quantity=4 and warehouse_quantity=2 and temporary_out_quantity=2 from inventory.products where id=p),'Edited multi-location stock');
 perform pg_temp.inventory_function_assert((select count(*)=2 from inventory.movements where product_id=p and action_type='receive_stock'),'One movement per nonzero location');
 perform pg_temp.inventory_function_assert((select price=12 and freight_cost=2 from inventory.product_costs where product_id=p),'Partial costs preserve other components');
 perform pg_temp.inventory_function_assert((select product_id=p and product_request_id is null and storage_path='requests/'||r::text||'/photo.jpg' from inventory.product_images where id=photo),'Request photo relink preserves stored path');
 perform pg_temp.inventory_function_assert((select approved_product_id=p and reviewed_by=auth.uid() and reviewed_at is not null and review_note='Checked' from inventory.product_requests where id=r),'Review audit links product');
end $$;
reset role; rollback;
