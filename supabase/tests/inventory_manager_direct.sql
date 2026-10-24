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
do $$ declare f record; result jsonb; begin
 select * into f from inventory_function_fixture;
 perform set_config('request.jwt.claim.sub',(select id::text from inventory_function_actors where label='admin_manager'),true);
 result:=inventory.submit_product_request(jsonb_build_object('brand_id',f.brand_id,'category_id',f.category_id,'stock_ref',f.marker||'d','item_code',f.marker||'d','item_name','Chair','model_name','M','quantity',2));
 perform pg_temp.inventory_function_assert(result->>'product_id' is not null,'Manager product immediate');
 result:=inventory.submit_movement_request(f.product_id,'take','sale','warehouse',null,2,null);
 perform pg_temp.inventory_function_assert(result->>'movement_id' is not null,'Manager movement immediate');
 perform pg_temp.inventory_function_assert((select quantity=18 from inventory.products where id=f.product_id),'Stock applied');
end $$;
reset role; rollback;
