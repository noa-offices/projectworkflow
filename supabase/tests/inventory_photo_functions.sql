-- Run only in a disposable database, after the inventory migrations.
-- psql -X -v ON_ERROR_STOP=1; fixtures and helpers are rolled back.
-- No storage.objects deletes or storage trigger changes.
begin;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
create temporary table inventory_photo_actors (
  label text primary key, id uuid not null default gen_random_uuid(),
  role public.user_role not null, status public.account_status not null default 'active'
) on commit drop;
insert into inventory_photo_actors(label,role,status) values
 ('system_owner','system_owner','active'), ('admin_manager','admin_manager','active'),
 ('procurement_manager','procurement_manager','active'), ('sales_designer','sales_designer','active'),
 ('sales_coordinator','sales_coordinator','active'), ('designer','designer','active'),
 ('viewer','viewer','active'), ('warehouse_staff','warehouse_staff','active'),
 ('pending','warehouse_staff','pending'), ('disabled','admin_manager','disabled');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select id,id::text || '@inventory-functions.invalid','{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb from inventory_photo_actors;
insert into public.profiles(id,email,full_name,role,account_status)
select id,id::text || '@inventory-functions.invalid',label,role,status from inventory_photo_actors
on conflict(id) do update set role=excluded.role,account_status=excluded.account_status;
create temporary table inventory_photo_fixture on commit drop as
select gen_random_uuid() brand_id, gen_random_uuid() category_id, gen_random_uuid() product_id,
  'inventory-functions-' || gen_random_uuid()::text marker;
insert into public.brands(id,name) select brand_id,marker from inventory_photo_fixture;
insert into inventory.categories(id,name,slug) select category_id,marker,marker from inventory_photo_fixture;
insert into inventory.products(id,brand_id,category_id,stock_ref,item_code,item_name,model_name,quantity,warehouse_quantity)
select product_id,brand_id,category_id,marker,marker,marker,marker,20,20 from inventory_photo_fixture;
grant select on inventory_photo_actors,inventory_photo_fixture to authenticated;

create function pg_temp.inventory_photo_expect_error(command text, expected_state text, message_part text default '')
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
create function pg_temp.inventory_photo_assert(ok boolean, message text)
returns void language plpgsql security invoker as $$
begin
  if ok is distinct from true then raise exception 'Assertion failed: %',message; end if;
end $$;
-- A request with three photos exercises the other owner constraint and pending guard.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from inventory_photo_actors where label='admin_manager'),'role','authenticated')::text,true);
alter table inventory_photo_fixture add column request_id uuid default gen_random_uuid();
insert into inventory.product_requests(id,brand_id,category_id,stock_ref,item_code,item_name,model_name,quantity,submitted_by)
select request_id,brand_id,category_id,marker,marker,marker,marker,1,auth.uid() from inventory_photo_fixture;
insert into inventory.product_images(product_id,storage_path,sort_order,is_main)
select product_id,'products/' || product_id::text || '/' || n || '.jpg',n,n=0 from inventory_photo_fixture cross join generate_series(0,2) n;
insert into inventory.product_images(product_request_id,storage_path,sort_order,is_main)
select request_id,'requests/' || request_id::text || '/' || n || '.jpg',n,n=0 from inventory_photo_fixture cross join generate_series(0,2) n;

create temporary table inventory_photo_ids on commit drop as select id,sort_order slot,case when product_id is not null then 'product' else 'request' end kind from inventory.product_images;
grant select on inventory_photo_ids to authenticated;
set local role authenticated;
do $$
declare actor record; f record; chosen uuid; result text; allowed boolean; owner_kind text; ids uuid[]; expected_path text;
begin
 select * into f from inventory_photo_fixture;
 for actor in select * from inventory_photo_actors order by label loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.id,'role','authenticated')::text,true);
  allowed := actor.status='active' and actor.role in ('system_owner','admin_manager');
  select id into chosen from inventory.product_images where product_id=f.product_id and sort_order=2;
  -- Pending accounts cannot SELECT images, so use a manager-selected fixture ID below.
  if chosen is null then
   chosen := (select id from inventory_photo_ids where slot=2 and kind='product');
  end if;
  if allowed then
   perform inventory.set_main_product_photo(chosen);
   perform pg_temp.inventory_photo_assert(exists(select 1 from inventory.product_images where id=chosen and is_main and sort_order=0),'Manager can switch main');
   -- Exercise removal for each manager while rolling back only this probe.
   begin
    result := inventory.remove_product_photo(chosen);
    perform pg_temp.inventory_photo_assert(result is not null,'Manager can remove photo');
    raise exception 'Undo matrix removal probe' using errcode='ZX001';
   exception when sqlstate 'ZX001' then null;
   end;
  else
   perform pg_temp.inventory_photo_expect_error(format('select inventory.set_main_product_photo(%L)',chosen),'42501');
   perform pg_temp.inventory_photo_expect_error(format('select inventory.remove_product_photo(%L)',chosen),'42501');
  end if;
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from inventory_photo_actors where label='admin_manager'),'role','authenticated')::text,true);
 foreach owner_kind in array array['product','request'] loop
  -- Literal expected slots catch immediate-unique swap errors and wrong old-main placement.
  select array_agg(id order by sort_order) into ids from inventory.product_images
   where (owner_kind='product' and product_id=f.product_id) or (owner_kind='request' and product_request_id=f.request_id);
  perform inventory.set_main_product_photo(ids[3]);
  perform pg_temp.inventory_photo_assert((select sort_order=2 and not is_main from inventory.product_images where id=ids[1]),'Old main moves to chosen old slot');
  perform pg_temp.inventory_photo_assert((select sort_order=0 and is_main from inventory.product_images where id=ids[3]),'Chosen becomes first and main');
  perform inventory.set_main_product_photo(ids[3]);
  select storage_path into expected_path from inventory.product_images where id=ids[3];
  result := inventory.remove_product_photo(ids[3]);
  perform pg_temp.inventory_photo_assert(result=expected_path,'Return exact storage path for later object cleanup');
  perform pg_temp.inventory_photo_assert(not exists(select 1 from inventory.product_images where id=ids[3]),'Deleted selected metadata');
  perform pg_temp.inventory_photo_assert((select sort_order=0 and is_main from inventory.product_images where id=ids[2]),'Lowest remaining photo promoted');
  perform pg_temp.inventory_photo_assert((select sort_order=1 and not is_main from inventory.product_images where id=ids[1]),'Remaining slots compacted');
  result := inventory.remove_product_photo(ids[1]);
  perform pg_temp.inventory_photo_assert((select sort_order=0 and is_main from inventory.product_images where id=ids[2]),'Non-main removal preserves main');
  perform inventory.remove_product_photo(ids[2]);
 end loop;
 insert into inventory.product_images(product_id,storage_path,sort_order,is_main)
 select f.product_id,'products/' || f.product_id::text || '/middle-' || n || '.jpg',n,n=0 from generate_series(0,2) n;
 select array_agg(id order by sort_order) into ids from inventory.product_images where product_id=f.product_id;
 perform inventory.remove_product_photo(ids[2]);
 perform pg_temp.inventory_photo_assert((select is_main and sort_order=0 from inventory.product_images where id=ids[1]),'Middle non-main removal preserves main');
 perform pg_temp.inventory_photo_assert((select not is_main and sort_order=1 from inventory.product_images where id=ids[3]),'Middle non-main removal closes slot gap');
 -- Calls must restore immediate uniqueness, rather than leak deferred state to callers.
 perform pg_temp.inventory_photo_expect_error(format('insert into inventory.product_images(product_id,storage_path,sort_order) values(%L,''duplicate.jpg'',1)',f.product_id),'23505');
 perform pg_temp.inventory_photo_expect_error(format('select inventory.set_main_product_photo(%L)',gen_random_uuid()),'P0001','Photo not found');
 perform pg_temp.inventory_photo_expect_error(format('select inventory.remove_product_photo(%L)',gen_random_uuid()),'P0001','Photo not found');
 perform set_config('request.jwt.claims','{}',true);
 perform pg_temp.inventory_photo_expect_error(format('select inventory.set_main_product_photo(%L)',gen_random_uuid()),'42501');
 perform pg_temp.inventory_photo_expect_error(format('select inventory.remove_product_photo(%L)',gen_random_uuid()),'42501');
end $$;
reset role;
set local role anon;
select pg_temp.inventory_photo_expect_error(format('select inventory.set_main_product_photo(%L)',gen_random_uuid()),'42501');
select pg_temp.inventory_photo_expect_error(format('select inventory.remove_product_photo(%L)',gen_random_uuid()),'42501');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{}',true);
select pg_temp.inventory_photo_expect_error(format('select inventory.set_main_product_photo(%L)',gen_random_uuid()),'42501');
select pg_temp.inventory_photo_expect_error(format('select inventory.remove_product_photo(%L)',gen_random_uuid()),'42501');
reset role;
rollback;
