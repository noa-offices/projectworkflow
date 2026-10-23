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
do $$
declare f record; movement_id uuid; action text; amount integer; before_row jsonb; before_count bigint;
begin
  select * into f from inventory_function_fixture;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from inventory_function_actors where label='admin_manager'),'role','authenticated')::text,true);
  movement_id := inventory.record_direct_movement(f.product_id,'receive_stock',null,null,5,'received');
  perform pg_temp.inventory_function_stock(f.product_id,array[25,0,0,0,0,0,25]);
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.movements where id=movement_id and previous_quantity=20 and new_quantity=25 and movement_type='stock_in' and created_by=auth.uid()),'Receive movement');
  perform pg_temp.inventory_function_movement(movement_id,'receive_stock',20,25);
  movement_id:=inventory.record_direct_movement(f.product_id,'internal_transfer','warehouse','dubai_showroom',5,'transfer');
  perform pg_temp.inventory_function_stock(f.product_id,array[20,5,0,0,0,0,25]);
  perform pg_temp.inventory_function_movement(movement_id,'internal_transfer',25,25);
  perform inventory.record_direct_movement(f.product_id,'internal_transfer','warehouse','abudhabi_showroom',2,null);
  perform inventory.record_direct_movement(f.product_id,'internal_transfer','warehouse','mockup',3,null);
  perform inventory.record_direct_movement(f.product_id,'internal_transfer','warehouse','temporary_out',4,null);
  perform pg_temp.inventory_function_stock(f.product_id,array[11,5,2,3,4,0,25]);
  movement_id:=inventory.record_direct_movement(f.product_id,'return_to_warehouse','dubai_showroom','warehouse',2,'returned');
  perform pg_temp.inventory_function_stock(f.product_id,array[13,3,2,3,4,0,25]);
  perform pg_temp.inventory_function_movement(movement_id,'return_to_warehouse',25,25);
  movement_id:=inventory.record_direct_movement(f.product_id,'sale','mockup',null,2,'sold');
  perform pg_temp.inventory_function_stock(f.product_id,array[13,3,2,1,4,2,23]);
  perform pg_temp.inventory_function_movement(movement_id,'sale',25,23);
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.movements where id=movement_id and to_location='sold' and reference_type='manual'),'Sale destination');
  movement_id:=inventory.record_direct_movement(f.product_id,'adjustment',null,null,7,'counted');
  perform pg_temp.inventory_function_stock(f.product_id,array[7,0,0,0,0,2,7]);
  perform pg_temp.inventory_function_movement(movement_id,'adjustment',23,7);
  movement_id:=inventory.record_direct_movement(f.product_id,'adjustment',null,null,0,'empty');
  perform pg_temp.inventory_function_stock(f.product_id,array[0,0,0,0,0,2,0]);
  perform pg_temp.inventory_function_movement(movement_id,'adjustment',7,0);
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.movements where id=movement_id and quantity=0 and reference_type='adjustment'),'Zero adjustment');
  perform inventory.record_direct_movement(f.product_id,'receive_stock',null,null,20,null);
  select to_jsonb(p) into before_row from inventory.products p where id=f.product_id;
  select count(*) into before_count from inventory.movements;
  perform pg_temp.inventory_function_expect_error(format('select inventory.record_direct_movement(%L,''internal_transfer'',''warehouse'',''dubai_showroom'',100,null)',f.product_id),'P0001','Only 20 units are in warehouse');
  perform pg_temp.inventory_function_expect_error(format('select inventory.record_direct_movement(%L,''sale'',''warehouse'',null,100,null)',f.product_id),'P0001','Only 20 units are in warehouse');
  perform pg_temp.inventory_function_assert((select to_jsonb(p)=before_row from inventory.products p where id=f.product_id) and (select count(*)=before_count from inventory.movements),'Failed changes leave all product fields and movements unchanged');
  foreach action in array array['receive_stock','internal_transfer','return_to_warehouse','sale','adjustment'] loop
    foreach amount in array array[-1,0] loop
      if amount=0 and action='adjustment' then continue; end if;
      perform pg_temp.inventory_function_expect_error(format('select inventory.record_direct_movement(%L,%L,''warehouse'',''dubai_showroom'',%s,null)',f.product_id,action,amount),'P0001','Quantity');
      perform pg_temp.inventory_function_expect_error(format('select inventory.submit_movement_request(%L,''move'',%L,''warehouse'',''dubai_showroom'',%s,null)',f.product_id,action,amount),'P0001','Quantity');
      -- Exercise both CHECK constraints independently of function validation.
      perform pg_temp.inventory_function_expect_error(format('insert into inventory.movements(product_id,movement_type,action_type,quantity,previous_quantity,new_quantity,created_by) values(%L,''adjustment'',%L,%s,20,20,auth.uid())',f.product_id,action,amount),'23514','inventory_movements_quantity_positive');
      perform pg_temp.inventory_function_expect_error(format('insert into inventory.movement_requests(product_id,request_type,movement_type,action_type,quantity,submitted_by) values(%L,''move'',''adjustment'',%L,%s,auth.uid())',f.product_id,action,amount),'23514','inventory_movement_requests_quantity_positive');
    end loop;
  end loop;
  perform pg_temp.inventory_function_expect_error(format('select inventory.record_direct_movement(%L,''sale'',''sold'',null,1,null)',f.product_id),'P0001','live location');
  perform pg_temp.inventory_function_expect_error(format('select inventory.record_direct_movement(%L,''internal_transfer'',''warehouse'',''warehouse'',1,null)',f.product_id),'P0001','different live');
  perform pg_temp.inventory_function_expect_error(format('select inventory.record_direct_movement(%L,''internal_transfer'',''warehouse'',''sold'',1,null)',f.product_id),'P0001','different live');
  perform pg_temp.inventory_function_expect_error(format('select inventory.record_direct_movement(%L,''return_to_warehouse'',''warehouse'',''dubai_showroom'',1,null)',f.product_id),'P0001','Return destination');
end $$;

-- Review state and audit fields, including approval-time stock revalidation.
do $$
declare f record; request_id uuid; movement_id uuid; baseline bigint; actor uuid;
begin
  select * into f from inventory_function_fixture;
  actor:=auth.uid();
  request_id:=inventory.submit_movement_request(f.product_id,'move','internal_transfer','warehouse','dubai_showroom',3,'move');
  perform pg_temp.inventory_function_stock(f.product_id,array[20,0,0,0,0,2,20]);
  perform inventory.review_movement_request(request_id,'approved','approved move');
  perform pg_temp.inventory_function_stock(f.product_id,array[17,3,0,0,0,2,20]);
  select approved_movement_id into movement_id from inventory.movement_requests where id=request_id;
  perform pg_temp.inventory_function_movement(movement_id,'internal_transfer',20,20);
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.movements where id=movement_id and reference_type='take_item' and reference_id=request_id),'Request movement reference');
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.movement_requests where id=request_id and reviewed_by=actor and reviewed_at is not null and review_note='approved move'),'Review audit');
  perform pg_temp.inventory_function_expect_error(format('select inventory.review_movement_request(%L,''approved'',null)',request_id),'P0001','already been reviewed');
  request_id:=inventory.submit_movement_request(f.product_id,'take','sale','warehouse',null,2,'reject');
  select count(*) into baseline from inventory.movements;
  perform inventory.review_movement_request(request_id,'rejected','no');
  perform pg_temp.inventory_function_assert((select count(*)=baseline from inventory.movements),'Rejection writes no movement');
  perform pg_temp.inventory_function_stock(f.product_id,array[17,3,0,0,0,2,20]);
  perform pg_temp.inventory_function_expect_error(format('select inventory.review_movement_request(%L,''rejected'',null)',request_id),'P0001','already been reviewed');
  request_id:=inventory.submit_movement_request(f.product_id,'hold','internal_transfer',null,null,1,'hold');
  perform inventory.review_movement_request(request_id,'approved','hold only');
  perform pg_temp.inventory_function_assert((select approved_movement_id is null from inventory.movement_requests where id=request_id) and (select count(*)=baseline from inventory.movements),'Hold has no stock movement');
  request_id:=inventory.submit_movement_request(f.product_id,'book','internal_transfer',null,null,1,'book');
  perform inventory.review_movement_request(request_id,'approved',null);
  perform pg_temp.inventory_function_stock(f.product_id,array[17,3,0,0,0,2,20]);
  request_id:=inventory.submit_movement_request(f.product_id,'take','sale','warehouse',null,17,null);
  perform inventory.record_direct_movement(f.product_id,'sale','warehouse',null,1,null);
  perform pg_temp.inventory_function_expect_error(format('select inventory.review_movement_request(%L,''approved'',null)',request_id),'P0001','Only 16 units are in warehouse');
  perform pg_temp.inventory_function_assert((select request_status='pending_review' and reviewed_by is null and approved_movement_id is null from inventory.movement_requests where id=request_id),'Failed approval stays pending');
  perform pg_temp.inventory_function_stock(f.product_id,array[16,3,0,0,0,3,19]);
  request_id:=inventory.submit_movement_request(f.product_id,'move','adjustment',null,null,0,'zero request');
  perform inventory.review_movement_request(request_id,'approved',null);
  perform pg_temp.inventory_function_stock(f.product_id,array[0,0,0,0,0,3,0]);
  perform inventory.record_direct_movement(f.product_id,'receive_stock',null,null,20,null);
end $$;

-- Role matrix: all eight roles plus pending/disabled accounts. Claims are session-local.
do $$
declare actor record; f record; kind text; command text; allowed boolean; request_id uuid; payload jsonb;
begin
  select * into f from inventory_function_fixture;
  for actor in select * from inventory_function_actors order by label loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.id,'role','authenticated')::text,true);
    foreach kind in array array['take','move','hold','book'] loop
      command:=format('select inventory.submit_movement_request(%L,%L,''internal_transfer'',%L,%L,1,null)',f.product_id,kind,
        case when kind in ('take','move') then 'warehouse' end,case when kind in ('take','move') then 'dubai_showroom' end);
      allowed:=actor.status='active' and (actor.role in ('system_owner','admin_manager')
        or (actor.role='warehouse_staff' and kind in ('take','move'))
        or (actor.role in ('procurement_manager','sales_designer','sales_coordinator','designer') and kind in ('hold','book')));
      if allowed then execute command into request_id;
      else perform pg_temp.inventory_function_expect_error(command,'42501'); end if;
    end loop;
    payload:=jsonb_build_object('brand_id',f.brand_id,'category_id',f.category_id,'stock_ref',actor.id,'item_code',actor.id,
      'item_name','Request','model_name','Model','quantity',2,'costs',jsonb_build_object('price',123));
    if actor.status='active' and actor.role in ('system_owner','admin_manager','warehouse_staff') then
      request_id:=inventory.submit_product_request(payload);
      perform pg_temp.inventory_function_assert(exists(select 1 from inventory.product_requests where id=request_id and submitted_by=actor.id and request_status='pending_review'),'Product submitter and pending status');
      if actor.role='warehouse_staff' then
        -- A warehouse caller cannot inspect cost tables: inspect only the permitted count (zero).
        perform pg_temp.inventory_function_assert((select count(*)=0 from inventory.product_request_costs),'Warehouse cost visibility');
      end if;
    else perform pg_temp.inventory_function_expect_error(format('select inventory.submit_product_request(%L::jsonb)',payload),'42501'); end if;
    if actor.status<>'active' or actor.role not in ('system_owner','admin_manager') then
      foreach command in array array[
        format('select inventory.record_direct_movement(%L,''receive_stock'',null,null,1,null)',f.product_id),
        format('select inventory.review_movement_request(%L,''approved'',null)',request_id),
        format('select inventory.review_product_request(%L,''approved'',null)',request_id),
        format('select inventory.update_product(%L,''{}''::jsonb)',f.product_id),
        format('select inventory.remove_product(%L,''reason'')',f.product_id)
      ] loop perform pg_temp.inventory_function_expect_error(command,'42501'); end loop;
    end if;
    perform pg_temp.inventory_function_expect_error(format('select inventory.apply_stock_change(%L,''receive_stock'',null,null,1,null,''manual'',null,auth.uid())',f.product_id),'42501');
  end loop;
end $$;

-- Product approval, cost copying, image relinking, metadata patching and soft removal.
do $$
declare f record; payload jsonb; request_id uuid; v_new_product uuid; actor uuid; movement_id uuid; path text; baseline bigint;
begin
  select * into f from inventory_function_fixture;
  select id into actor from inventory_function_actors where label='warehouse_staff';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  payload:=jsonb_build_object('brand_id',f.brand_id,'category_id',f.category_id,'stock_ref',f.marker || '-warehouse',
    'item_code',f.marker || '-warehouse','item_name','Warehouse request','model_name','Model','quantity',2,
    'submitted_by',gen_random_uuid(),'request_status','approved','costs',jsonb_build_object('price',999));
  request_id:=inventory.submit_product_request(payload);
  path:='requests/' || request_id::text || '/main.jpg';
  insert into inventory.product_images(product_request_id,storage_path,is_main,sort_order,uploaded_by)
  values(request_id,path,true,0,auth.uid()),(request_id,'requests/' || request_id::text || '/second.jpg',false,1,auth.uid()),
    (request_id,'requests/' || request_id::text || '/third.jpg',false,2,auth.uid());
  select id into actor from inventory_function_actors where label='system_owner';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  perform pg_temp.inventory_function_assert(not exists(select 1 from inventory.product_request_costs where product_request_id=request_id),'Warehouse costs ignored, checked as manager');
  v_new_product:=inventory.review_product_request(request_id,'approved','accepted');
  perform pg_temp.inventory_function_stock(v_new_product,array[2,0,0,0,0,0,2]);
  perform pg_temp.inventory_function_assert(not exists(select 1 from inventory.product_costs c where c.product_id=v_new_product),'No warehouse costs copied');
  perform pg_temp.inventory_function_assert((select count(*)=3 and count(*) filter(where is_main)=1 from inventory.product_images i where i.product_id=v_new_product and i.product_request_id is null),'Three images relinked');
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.product_images i where i.product_id=v_new_product and storage_path=path),'Image path retained');
  select id into movement_id from inventory.movements m where m.product_id=v_new_product;
  perform pg_temp.inventory_function_movement(movement_id,'receive_stock',0,2);
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.movements where id=movement_id and reference_type='product_request' and reference_id=request_id),'Product movement reference');
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.product_requests r where r.id=request_id and approved_product_id=v_new_product and reviewed_by=actor and reviewed_at is not null and request_status='approved'),'Product review audit');
  perform pg_temp.inventory_function_expect_error(format('select inventory.review_product_request(%L,''approved'',null)',request_id),'P0001','already been reviewed');
  payload:=payload || jsonb_build_object('stock_ref',f.marker || '-manager','item_code',f.marker || '-manager','requested_status','showroom',
    'costs',jsonb_build_object('price',10,'freight_cost',1,'c_and_f',2,'transport',3,'custom_duty',4,'labour',5,'vat',6,'total_cost',999));
  request_id:=inventory.submit_product_request(payload);
  v_new_product:=inventory.review_product_request(request_id,'approved',null);
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.product_costs c where c.product_id=v_new_product and total_cost=31),'Manager costs copied and generated total');
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.products p where p.id=v_new_product and status='showroom'),'Requested status copied');
  perform inventory.update_product(v_new_product,jsonb_build_object('item_name','Renamed','low_stock_at',5,'quantity',500,'warehouse_quantity',500,
    'dubai_showroom_quantity',500,'abudhabi_showroom_quantity',500,'mockup_quantity',500,'temporary_out_quantity',500,
    'sold_quantity',500,'is_active',false,'updated_by',gen_random_uuid(),'costs',jsonb_build_object('price',20,'total_cost',900)));
  perform pg_temp.inventory_function_stock(v_new_product,array[2,0,0,0,0,0,2]);
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.products p where p.id=v_new_product and item_name='Renamed' and low_stock_at=5 and is_active and updated_by=actor),'Whitelisted metadata and actor');
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.product_costs c where c.product_id=v_new_product and price=20 and freight_cost=1 and total_cost=41),'Partial costs patch');
  perform pg_temp.inventory_function_expect_error(format('select inventory.remove_product(%L,'' '')',v_new_product),'P0001','Reason');
  perform inventory.remove_product(v_new_product,'obsolete');
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.products p where p.id=v_new_product and not is_active and removed_by=actor and removed_at is not null and removal_reason='obsolete'),'Soft removal audit');
  perform pg_temp.inventory_function_expect_error(format('select inventory.record_direct_movement(%L,''receive_stock'',null,null,1,null)',v_new_product),'P0001','Active product');
  perform pg_temp.inventory_function_expect_error(format('select inventory.submit_movement_request(%L,''take'',''sale'',''warehouse'',null,1,null)',v_new_product),'P0001','Active product');
  payload:=payload || jsonb_build_object('stock_ref',f.marker || '-reject','item_code',f.marker || '-reject');
  request_id:=inventory.submit_product_request(payload);
  select count(*) into baseline from inventory.products;
  perform pg_temp.inventory_function_assert(inventory.review_product_request(request_id,'rejected','no') is null,'Rejected product returns null');
  perform pg_temp.inventory_function_assert((select count(*)=baseline from inventory.products),'Rejected product creates no product');
  perform pg_temp.inventory_function_expect_error(format('select inventory.review_product_request(%L,''approved'',null)',request_id),'P0001','already been reviewed');
  -- Duplicate approval is rolled back completely and remains reviewable.
  payload:=payload || jsonb_build_object('stock_ref',f.marker || '-duplicate','item_code',f.marker);
  request_id:=inventory.submit_product_request(payload);
  perform pg_temp.inventory_function_expect_error(format('select inventory.review_product_request(%L,''approved'',null)',request_id),'P0001','item code already in use');
  perform pg_temp.inventory_function_assert((select request_status='pending_review' from inventory.product_requests where id=request_id) and (select count(*)=baseline from inventory.products),'Duplicate approval is atomic');
  payload:=payload || jsonb_build_object('stock_ref',f.marker,'item_code',f.marker || '-unique-code');
  request_id:=inventory.submit_product_request(payload);
  perform pg_temp.inventory_function_expect_error(format('select inventory.review_product_request(%L,''approved'',null)',request_id),'P0001','stock ref already in use');
  perform pg_temp.inventory_function_expect_error('select inventory.submit_product_request(''[]''::jsonb)','P0001','JSON object');
  perform pg_temp.inventory_function_expect_error(format('select inventory.update_product(%L,''[]''::jsonb)',f.product_id),'P0001','JSON object');
  perform pg_temp.inventory_function_expect_error(format('select inventory.review_product_request(%L,''pending_review'',null)',request_id),'P0001','Decision');
  perform pg_temp.inventory_function_expect_error(format('select inventory.review_movement_request(%L,null,null)',request_id),'P0001','Decision');
  select count(*) into baseline from inventory.product_requests;
  payload:=payload || jsonb_build_object('costs','bad costs');
  perform pg_temp.inventory_function_expect_error(format('select inventory.submit_product_request(%L::jsonb)',payload),'P0001','Costs must be');
  perform pg_temp.inventory_function_assert((select count(*)=baseline from inventory.product_requests),'Invalid costs roll back submission');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from inventory_function_actors where label='warehouse_staff'),'role','authenticated')::text,true);
  request_id:=inventory.submit_product_request(payload);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  perform pg_temp.inventory_function_assert(not exists(select 1 from inventory.product_request_costs where product_request_id=request_id),'Warehouse costs ignored even when malformed');
end $$;

-- Pending request photos work for their submitter; reviewed requests reject new photos,
-- including manager INSERTs that otherwise pass the existing table policies.
do $$
declare f record; request_id uuid; new_product uuid; payload jsonb; owner_id uuid; warehouse_id uuid;
begin
  select * into f from inventory_function_fixture;
  select id into owner_id from inventory_function_actors where label='admin_manager';
  select id into warehouse_id from inventory_function_actors where label='warehouse_staff';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',warehouse_id,'role','authenticated')::text,true);
  payload:=jsonb_build_object('brand_id',f.brand_id,'category_id',f.category_id,'stock_ref',f.marker || '-photo-approved',
    'item_code',f.marker || '-photo-approved','item_name','Photo request','model_name','Model','quantity',1);
  request_id:=inventory.submit_product_request(payload);
  insert into inventory.product_images(product_request_id,storage_path,sort_order,is_main,uploaded_by)
  values(request_id,'requests/' || request_id::text || '/pending.jpg',0,true,auth.uid());
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.product_images i where i.product_request_id=request_id),'Pending request accepts submitter photo');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  new_product:=inventory.review_product_request(request_id,'approved',null);
  perform pg_temp.inventory_function_expect_error(format('insert into inventory.product_images(product_request_id,storage_path,sort_order,uploaded_by) values(%L,''reviewed-approved.jpg'',1,auth.uid())',request_id),'42501','pending product request');
  insert into inventory.product_images(product_id,storage_path,sort_order,uploaded_by)
  values(new_product,'products/' || new_product::text || '/manager.jpg',1,auth.uid());
  perform pg_temp.inventory_function_assert(exists(select 1 from inventory.product_images i where i.product_id=new_product and sort_order=1),'Manager product photo unaffected');
  payload:=payload || jsonb_build_object('stock_ref',f.marker || '-photo-rejected','item_code',f.marker || '-photo-rejected');
  request_id:=inventory.submit_product_request(payload);
  insert into inventory.product_images(product_request_id,storage_path,sort_order,uploaded_by)
  values(request_id,'requests/' || request_id::text || '/pending-manager.jpg',0,auth.uid());
  perform inventory.review_product_request(request_id,'rejected',null);
  perform pg_temp.inventory_function_expect_error(format('insert into inventory.product_images(product_request_id,storage_path,sort_order,uploaded_by) values(%L,''reviewed-rejected.jpg'',1,auth.uid())',request_id),'42501','pending product request');
end $$;
reset role;

-- Validate the complete function ACL and configuration, independently of schema usage.
do $$
declare fn record; internal boolean; signature text; functions integer:=0;
begin
  for fn in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='inventory' and p.proname in ('apply_stock_change','record_direct_movement','submit_movement_request',
      'review_movement_request','submit_product_request','review_product_request','update_product','remove_product') loop
    functions:=functions+1;
    internal:=fn.proname='apply_stock_change'; signature:=fn.oid::regprocedure::text;
    perform pg_temp.inventory_function_assert(fn.prosecdef and fn.prolang=(select oid from pg_language where lanname='plpgsql')
      and 'search_path=inventory, public'=any(fn.proconfig) and fn.prorettype in ('uuid'::regtype,'void'::regtype),'Function settings: ' || signature);
    perform pg_temp.inventory_function_assert(not has_function_privilege('anon',fn.oid,'EXECUTE'),'Anon ACL: ' || signature);
    perform pg_temp.inventory_function_assert(has_function_privilege('authenticated',fn.oid,'EXECUTE')=not internal,'Authenticated ACL: ' || signature);
    perform pg_temp.inventory_function_assert(has_function_privilege('service_role',fn.oid,'EXECUTE')=not internal,'Service ACL: ' || signature);
  end loop;
  perform pg_temp.inventory_function_assert(functions=8,'Exactly eight inventory write functions');
  select p.* into fn from pg_proc p where p.oid='inventory.guard_product_request_image_insert()'::regprocedure;
  perform pg_temp.inventory_function_assert(fn.prosecdef and fn.prolang=(select oid from pg_language where lanname='plpgsql')
    and fn.prorettype='trigger'::regtype and 'search_path=inventory, public'=any(fn.proconfig),'Photo trigger function settings');
  perform pg_temp.inventory_function_assert(not has_function_privilege('anon',fn.oid,'EXECUTE')
    and not has_function_privilege('authenticated',fn.oid,'EXECUTE')
    and not has_function_privilege('service_role',fn.oid,'EXECUTE'),'Photo trigger function ACL');
  perform pg_temp.inventory_function_assert((select count(*)=1 from pg_trigger
    where tgrelid='inventory.product_images'::regclass and tgname='product_images_guard_request_insert'
      and tgfoid=fn.oid and tgtype=7 and tgenabled='O'),'One enabled BEFORE INSERT row trigger');
end $$;
set local role anon;
do $$
declare command text;
begin
  foreach command in array array[
    'select inventory.apply_stock_change(null,''receive_stock'',null,null,1,null,''manual'',null,null)',
    'select inventory.record_direct_movement(null,''receive_stock'',null,null,1,null)',
    'select inventory.submit_movement_request(null,''take'',''sale'',''warehouse'',null,1,null)',
    'select inventory.review_movement_request(null,''approved'',null)',
    'select inventory.submit_product_request(''{}''::jsonb)',
    'select inventory.review_product_request(null,''approved'',null)',
    'select inventory.update_product(null,''{}''::jsonb)',
    'select inventory.remove_product(null,''reason'')'
  ] loop perform pg_temp.inventory_function_expect_error(command,'42501'); end loop;
end $$;
reset role;
rollback;
