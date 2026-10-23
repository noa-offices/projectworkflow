-- Atomic inventory writes. Actors always come from the authenticated session.
begin;
-- Keep the existing constraint names; zero is valid only for adjustments.
alter table inventory.movements drop constraint if exists inventory_movements_quantity_positive;
alter table inventory.movements add constraint inventory_movements_quantity_positive
  check (quantity > 0 or (action_type = 'adjustment' and quantity >= 0));
alter table inventory.movement_requests drop constraint if exists inventory_movement_requests_quantity_positive;
alter table inventory.movement_requests add constraint inventory_movement_requests_quantity_positive
  check (quantity > 0 or (action_type = 'adjustment' and quantity >= 0));

-- Internal stock writer: lock, validate, update all buckets and record the movement atomically.
-- Only owner-executed functions call this; the supplied actor must match the session.
create or replace function inventory.apply_stock_change(
  product_id uuid, action_type text, from_location text, to_location text,
  quantity integer, note text, reference_type text, reference_id uuid, actor uuid
) returns uuid language plpgsql security definer set search_path = inventory, public as $$
declare
  p_product_id alias for $1; p_action alias for $2; p_from alias for $3; p_to alias for $4;
  p_quantity alias for $5; p_note alias for $6; p_reference alias for $7;
  p_reference_id alias for $8; p_actor alias for $9;
  v_product inventory.products%rowtype;
  v_locations text[] := array['warehouse','dubai_showroom','abudhabi_showroom','mockup','temporary_out'];
  v_buckets integer[]; v_source integer; v_target integer; v_total integer;
  v_type inventory.inventory_movement_type; v_id uuid;
  v_from text := p_from; v_to text := p_to;
begin
  if auth.uid() is null or p_actor is distinct from auth.uid() or not inventory.can_manage() then
    raise exception 'Inventory management permission required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('receive_stock','internal_transfer','return_to_warehouse','sale','adjustment') then
    raise exception 'Invalid action type';
  end if;
  if p_quantity is null or p_quantity < 0 or (p_quantity = 0 and p_action <> 'adjustment') then
    raise exception 'Quantity must be positive, or zero for adjustment';
  end if;
  if p_reference is null or p_reference not in ('manual','product_request','take_item','adjustment') then
    raise exception 'Invalid reference type';
  end if;
  select p.* into v_product from inventory.products p where p.id = p_product_id for update;
  if not found or not v_product.is_active then raise exception 'Active product not found'; end if;
  v_buckets := array[v_product.warehouse_quantity,v_product.dubai_showroom_quantity,
    v_product.abudhabi_showroom_quantity,v_product.mockup_quantity,v_product.temporary_out_quantity,v_product.sold_quantity];
  if p_action not in ('receive_stock','adjustment') then
    v_source := array_position(v_locations,p_from);
    if v_source is null then raise exception 'Source must be a live location'; end if;
    if p_action in ('internal_transfer','return_to_warehouse') then
      v_target := array_position(v_locations,p_to);
      if v_target is null or p_from = p_to then raise exception 'Transfer requires different live locations'; end if;
      if p_action = 'return_to_warehouse' and p_to <> 'warehouse' then raise exception 'Return destination must be warehouse'; end if;
    end if;
    if v_buckets[v_source] < p_quantity then
      raise exception 'Only % units are in %',v_buckets[v_source],p_from;
    end if;
  end if;
  case p_action
    when 'receive_stock' then
      v_buckets[1] := v_buckets[1] + p_quantity;
      v_type := 'stock_in'; v_from := null; v_to := 'warehouse';
    when 'sale' then
      v_buckets[v_source] := v_buckets[v_source] - p_quantity;
      v_buckets[6] := v_buckets[6] + p_quantity;
      v_type := 'stock_out'; v_to := 'sold';
    when 'adjustment' then
      v_buckets := array[p_quantity,0,0,0,0,v_buckets[6]];
      v_type := 'adjustment'; v_from := null; v_to := 'warehouse';
    else
      v_buckets[v_source] := v_buckets[v_source] - p_quantity;
      v_buckets[v_target] := v_buckets[v_target] + p_quantity;
      v_type := 'transfer';
  end case;
  v_total := v_buckets[1]+v_buckets[2]+v_buckets[3]+v_buckets[4]+v_buckets[5];
  update inventory.products p set warehouse_quantity=v_buckets[1],dubai_showroom_quantity=v_buckets[2],
    abudhabi_showroom_quantity=v_buckets[3],mockup_quantity=v_buckets[4],temporary_out_quantity=v_buckets[5],
    sold_quantity=v_buckets[6],quantity=v_total,updated_by=p_actor where p.id=p_product_id;
  insert into inventory.movements(product_id,movement_type,action_type,from_location,to_location,
    quantity,previous_quantity,new_quantity,note,reference_type,reference_id,created_by)
  values(p_product_id,v_type,p_action,v_from,v_to,p_quantity,v_product.quantity,v_total,p_note,p_reference,p_reference_id,p_actor)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function inventory.apply_stock_change(uuid,text,text,text,integer,text,text,uuid,uuid)
  from public,anon,authenticated,service_role;

-- Managers record a direct movement through the same internal writer as approvals.
create or replace function inventory.record_direct_movement(
  product_id uuid, action_type text, from_location text, to_location text, quantity integer, note text
) returns uuid language plpgsql security definer set search_path = inventory, public as $$
begin
  if auth.uid() is null or not inventory.can_manage() then
    raise exception 'Inventory management permission required' using errcode='42501';
  end if;
  return inventory.apply_stock_change(product_id,action_type,from_location,to_location,quantity,note,
    case when action_type='adjustment' then 'adjustment' else 'manual' end,null,auth.uid());
end $$;
revoke execute on function inventory.record_direct_movement(uuid,text,text,text,integer,text) from public,anon;
grant execute on function inventory.record_direct_movement(uuid,text,text,text,integer,text) to authenticated,service_role;

-- Submit a pending request after role and stock validation; stock is never reserved here.
create or replace function inventory.submit_movement_request(
  product_id uuid, request_type text, action_type text, from_location text, to_location text, quantity integer, note text
) returns uuid language plpgsql security definer set search_path = inventory, public as $$
declare
  p_product_id alias for $1; p_kind alias for $2; p_action alias for $3;
  p_from alias for $4; p_to alias for $5; p_quantity alias for $6; p_note alias for $7;
  v_product inventory.products%rowtype; v_id uuid; v_source integer; v_target integer;
  v_locations text[] := array['warehouse','dubai_showroom','abudhabi_showroom','mockup','temporary_out'];
  v_buckets integer[]; v_type inventory.inventory_movement_type;
  v_from text := p_from; v_to text := p_to;
begin
  if auth.uid() is null or not (inventory.can_manage()
    or (inventory.can_request_hold_book() and p_kind in ('hold','book'))
    or (inventory.can_request_add_take() and p_kind in ('take','move'))) then
    raise exception 'Movement request permission required' using errcode='42501';
  end if;
  if p_kind is null or p_kind not in ('take','move','hold','book') then raise exception 'Invalid request type'; end if;
  if p_action is null or p_action not in ('receive_stock','internal_transfer','return_to_warehouse','sale','adjustment') then raise exception 'Invalid action type'; end if;
  if p_quantity is null or p_quantity < 0 or (p_quantity=0 and p_action<>'adjustment') then
    raise exception 'Quantity must be positive, or zero for adjustment';
  end if;
  if (p_from is not null and not p_from = any(v_locations || array['sold']))
    or (p_to is not null and not p_to = any(v_locations || array['sold'])) then raise exception 'Invalid location'; end if;
  select p.* into v_product from inventory.products p where p.id=p_product_id for share;
  if not found or not v_product.is_active then raise exception 'Active product not found'; end if;
  if p_kind in ('take','move') then
    if p_action not in ('receive_stock','adjustment') then
      v_source := array_position(v_locations,p_from);
      if v_source is null then raise exception 'Source must be a live location'; end if;
      if p_action in ('internal_transfer','return_to_warehouse') then
        v_target := array_position(v_locations,p_to);
        if v_target is null or p_from=p_to then raise exception 'Transfer requires different live locations'; end if;
        if p_action='return_to_warehouse' and p_to<>'warehouse' then raise exception 'Return destination must be warehouse'; end if;
      end if;
      v_buckets := array[v_product.warehouse_quantity,v_product.dubai_showroom_quantity,
        v_product.abudhabi_showroom_quantity,v_product.mockup_quantity,v_product.temporary_out_quantity];
      if v_buckets[v_source]<p_quantity then raise exception 'Only % units are in %',v_buckets[v_source],p_from; end if;
    end if;
    if p_action in ('receive_stock','adjustment') then v_from:=null; v_to:='warehouse'; end if;
    if p_action='sale' then v_to:='sold'; end if;
  end if;
  v_type := case p_action when 'receive_stock' then 'stock_in' when 'sale' then 'stock_out'
    when 'adjustment' then 'adjustment' else 'transfer' end;
  insert into inventory.movement_requests(product_id,request_type,movement_type,action_type,
    from_location,to_location,quantity,note,submitted_by,request_status)
  values(p_product_id,p_kind,v_type,p_action,v_from,v_to,p_quantity,p_note,auth.uid(),'pending_review') returning id into v_id;
  return v_id;
end $$;
revoke execute on function inventory.submit_movement_request(uuid,text,text,text,text,integer,text) from public,anon;
grant execute on function inventory.submit_movement_request(uuid,text,text,text,text,integer,text) to authenticated,service_role;

-- Serialize reviews. Take/move approval revalidates current stock under the product lock.
create or replace function inventory.review_movement_request(request_id uuid, decision text, review_note text)
returns void language plpgsql security definer set search_path = inventory, public as $$
declare
  p_id alias for $1; p_decision alias for $2; p_note alias for $3;
  v_request inventory.movement_requests%rowtype; v_movement uuid;
begin
  if auth.uid() is null or not inventory.can_manage() then raise exception 'Inventory management permission required' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  select r.* into v_request from inventory.movement_requests r where r.id=p_id for update;
  if not found then raise exception 'Movement request not found'; end if;
  if v_request.request_status<>'pending_review' then raise exception 'Request has already been reviewed'; end if;
  if p_decision='approved' and v_request.request_type in ('take','move') then
    v_movement := inventory.apply_stock_change(v_request.product_id,v_request.action_type,v_request.from_location,
      v_request.to_location,v_request.quantity,v_request.note,'take_item',v_request.id,auth.uid());
  end if;
  update inventory.movement_requests r set request_status=p_decision::inventory.product_request_status,
    reviewed_by=auth.uid(),reviewed_at=now(),review_note=p_note,approved_movement_id=v_movement where r.id=p_id;
end $$;
revoke execute on function inventory.review_movement_request(uuid,text,text) from public,anon;
grant execute on function inventory.review_movement_request(uuid,text,text) to authenticated,service_role;

-- Copy only product-request fields; supplied identities/review state are ignored.
-- Warehouse costs are ignored without parsing or querying cost data.
create or replace function inventory.submit_product_request(payload jsonb)
returns uuid language plpgsql security definer set search_path = inventory, public as $$
declare
  v_fields jsonb; v_request inventory.product_requests%rowtype; v_costs jsonb; v_id uuid;
begin
  if auth.uid() is null or not (inventory.can_manage() or inventory.can_request_add_take()) then
    raise exception 'Product request permission required' using errcode='42501';
  end if;
  if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Product request must be a JSON object'; end if;
  select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into v_fields from jsonb_each(payload) e
  where e.key=any(array['brand_id','category_id','subcategory_id','custom_category_name','stock_ref','item_code',
    'item_name','model_name','description','quantity','requested_status','condition','source','note',
    'dimension_length','dimension_width','dimension_height','dimension_unit','item_type']);
  v_request:=jsonb_populate_record(null::inventory.product_requests,v_fields);
  if v_request.brand_id is null or v_request.category_id is null then raise exception 'Brand and category are required'; end if;
  if coalesce(length(trim(v_request.stock_ref)),0)=0 or coalesce(length(trim(v_request.item_code)),0)=0
    or coalesce(length(trim(v_request.item_name)),0)=0 or coalesce(length(trim(v_request.model_name)),0)=0 then
    raise exception 'Stock ref, item code, item name and model name are required';
  end if;
  if v_request.quantity is null or v_request.quantity<=0 then raise exception 'Product quantity must be positive'; end if;
  insert into inventory.product_requests(brand_id,category_id,subcategory_id,custom_category_name,stock_ref,
    item_code,item_name,model_name,description,quantity,requested_status,condition,source,note,
    dimension_length,dimension_width,dimension_height,dimension_unit,item_type,submitted_by,request_status)
  values(v_request.brand_id,v_request.category_id,v_request.subcategory_id,v_request.custom_category_name,v_request.stock_ref,
    v_request.item_code,v_request.item_name,v_request.model_name,v_request.description,v_request.quantity,
    coalesce(v_request.requested_status,'available'),coalesce(v_request.condition,'new'),coalesce(v_request.source,'manual_entry'),v_request.note,
    v_request.dimension_length,v_request.dimension_width,v_request.dimension_height,v_request.dimension_unit,
    coalesce(v_request.item_type,'product'),auth.uid(),'pending_review') returning id into v_id;
  if inventory.can_manage() and payload ? 'costs' then
    v_costs:=payload->'costs';
    if jsonb_typeof(v_costs)<>'object' then raise exception 'Costs must be a JSON object'; end if;
    insert into inventory.product_request_costs(product_request_id,price,freight_cost,c_and_f,transport,custom_duty,labour,vat)
    values(v_id,coalesce((v_costs->>'price')::numeric,0),coalesce((v_costs->>'freight_cost')::numeric,0),
      coalesce((v_costs->>'c_and_f')::numeric,0),coalesce((v_costs->>'transport')::numeric,0),
      coalesce((v_costs->>'custom_duty')::numeric,0),coalesce((v_costs->>'labour')::numeric,0),coalesce((v_costs->>'vat')::numeric,0));
  end if;
  return v_id;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Invalid product request field value';
end $$;
revoke execute on function inventory.submit_product_request(jsonb) from public,anon;
grant execute on function inventory.submit_product_request(jsonb) to authenticated,service_role;

-- Approve exactly once: create the product, apply initial stock, copy costs and relink photos.
-- Any failure rolls back the entire approval, including its movement and review fields.
create or replace function inventory.review_product_request(request_id uuid, decision text, review_note text)
returns uuid language plpgsql security definer set search_path = inventory, public as $$
declare
  p_id alias for $1; p_decision alias for $2; p_note alias for $3;
  v_request inventory.product_requests%rowtype; v_product uuid; v_constraint text;
begin
  if auth.uid() is null or not inventory.can_manage() then raise exception 'Inventory management permission required' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  select r.* into v_request from inventory.product_requests r where r.id=p_id for update;
  if not found then raise exception 'Product request not found'; end if;
  if v_request.request_status<>'pending_review' then raise exception 'Request has already been reviewed'; end if;
  if p_decision='approved' then
    insert into inventory.products(brand_id,category_id,subcategory_id,custom_category_name,stock_ref,item_code,
      item_name,model_name,description,status,condition,source,note,dimension_length,dimension_width,dimension_height,
      dimension_unit,item_type,created_by,updated_by)
    values(v_request.brand_id,v_request.category_id,v_request.subcategory_id,v_request.custom_category_name,
      v_request.stock_ref,v_request.item_code,v_request.item_name,v_request.model_name,v_request.description,
      v_request.requested_status,v_request.condition,v_request.source,v_request.note,v_request.dimension_length,
      v_request.dimension_width,v_request.dimension_height,v_request.dimension_unit,v_request.item_type,auth.uid(),auth.uid()) returning id into v_product;
    -- The internal writer supplies initial warehouse stock and a 0 -> initial-quantity audit row.
    perform inventory.apply_stock_change(v_product,'receive_stock',null,'warehouse',v_request.quantity,
      v_request.note,'product_request',v_request.id,auth.uid());
    insert into inventory.product_costs(product_id,price,freight_cost,c_and_f,transport,custom_duty,labour,vat)
    select v_product,c.price,c.freight_cost,c.c_and_f,c.transport,c.custom_duty,c.labour,c.vat
    from inventory.product_request_costs c where c.product_request_id=p_id;
    update inventory.product_images i set product_id=v_product,product_request_id=null where i.product_request_id=p_id;
  end if;
  update inventory.product_requests r set request_status=p_decision::inventory.product_request_status,
    reviewed_by=auth.uid(),reviewed_at=now(),review_note=p_note,approved_product_id=v_product where r.id=p_id;
  return v_product;
exception when unique_violation then
  get stacked diagnostics v_constraint=constraint_name;
  if v_constraint='products_active_item_code_key' then raise exception 'item code already in use'; end if;
  if v_constraint='products_active_stock_ref_key' then raise exception 'stock ref already in use'; end if;
  raise;
end $$;
revoke execute on function inventory.review_product_request(uuid,text,text) from public,anon;
grant execute on function inventory.review_product_request(uuid,text,text) to authenticated,service_role;

-- Metadata-only patch: stock, active/removal state, identities and audit fields are never accepted.
-- A partial costs object upserts only its supplied cost components; totals remain generated.
create or replace function inventory.update_product(product_id uuid, patch jsonb)
returns void language plpgsql security definer set search_path = inventory, public as $$
declare
  p_id alias for $1; v_product inventory.products%rowtype; v_fields jsonb; v_costs jsonb; v_constraint text;
begin
  if auth.uid() is null or not inventory.can_manage() then raise exception 'Inventory management permission required' using errcode='42501'; end if;
  if patch is null or jsonb_typeof(patch)<>'object' then raise exception 'Product patch must be a JSON object'; end if;
  select p.* into v_product from inventory.products p where p.id=p_id for update;
  if not found or not v_product.is_active then raise exception 'Active product not found'; end if;
  select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into v_fields from jsonb_each(patch) e
  where e.key=any(array['brand_id','category_id','subcategory_id','custom_category_name','stock_ref','item_code',
    'item_name','model_name','description','note','dimension_length','dimension_width','dimension_height',
    'dimension_unit','low_stock_at','status','condition','item_type','location']);
  v_product:=jsonb_populate_record(v_product,v_fields);
  update inventory.products p set brand_id=v_product.brand_id,category_id=v_product.category_id,
    subcategory_id=v_product.subcategory_id,custom_category_name=v_product.custom_category_name,
    stock_ref=v_product.stock_ref,item_code=v_product.item_code,item_name=v_product.item_name,model_name=v_product.model_name,
    description=v_product.description,note=v_product.note,dimension_length=v_product.dimension_length,
    dimension_width=v_product.dimension_width,dimension_height=v_product.dimension_height,dimension_unit=v_product.dimension_unit,
    low_stock_at=v_product.low_stock_at,status=v_product.status,condition=v_product.condition,item_type=v_product.item_type,
    location=v_product.location,updated_by=auth.uid() where p.id=p_id;
  if patch ? 'costs' then
    v_costs:=patch->'costs';
    if jsonb_typeof(v_costs)<>'object' then raise exception 'Costs must be a JSON object'; end if;
    insert into inventory.product_costs as c(product_id,price,freight_cost,c_and_f,transport,custom_duty,labour,vat)
    values(p_id,coalesce((v_costs->>'price')::numeric,0),coalesce((v_costs->>'freight_cost')::numeric,0),
      coalesce((v_costs->>'c_and_f')::numeric,0),coalesce((v_costs->>'transport')::numeric,0),
      coalesce((v_costs->>'custom_duty')::numeric,0),coalesce((v_costs->>'labour')::numeric,0),coalesce((v_costs->>'vat')::numeric,0))
    on conflict on constraint product_costs_pkey do update set
      price=case when v_costs ? 'price' then excluded.price else c.price end,
      freight_cost=case when v_costs ? 'freight_cost' then excluded.freight_cost else c.freight_cost end,
      c_and_f=case when v_costs ? 'c_and_f' then excluded.c_and_f else c.c_and_f end,
      transport=case when v_costs ? 'transport' then excluded.transport else c.transport end,
      custom_duty=case when v_costs ? 'custom_duty' then excluded.custom_duty else c.custom_duty end,
      labour=case when v_costs ? 'labour' then excluded.labour else c.labour end,
      vat=case when v_costs ? 'vat' then excluded.vat else c.vat end;
  end if;
exception
  when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid product patch field value';
  when unique_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint='products_active_item_code_key' then raise exception 'item code already in use'; end if;
    if v_constraint='products_active_stock_ref_key' then raise exception 'stock ref already in use'; end if;
    raise;
end $$;
revoke execute on function inventory.update_product(uuid,jsonb) from public,anon;
grant execute on function inventory.update_product(uuid,jsonb) to authenticated,service_role;

-- Soft removal preserves stock and movement history and records the manager's reason.
create or replace function inventory.remove_product(product_id uuid, reason text)
returns void language plpgsql security definer set search_path = inventory, public as $$
declare p_id alias for $1; p_reason alias for $2;
begin
  if auth.uid() is null or not inventory.can_manage() then raise exception 'Inventory management permission required' using errcode='42501'; end if;
  if coalesce(length(trim(p_reason)),0)=0 then raise exception 'Reason is required'; end if;
  perform 1 from inventory.products p where p.id=p_id and p.is_active for update;
  if not found then raise exception 'Active product not found'; end if;
  update inventory.products p set is_active=false,removed_at=now(),removed_by=auth.uid(),
    removal_reason=trim(p_reason),updated_by=auth.uid() where p.id=p_id;
end $$;
revoke execute on function inventory.remove_product(uuid,text) from public,anon;
grant execute on function inventory.remove_product(uuid,text) to authenticated,service_role;

-- Serialize request-photo INSERTs with review's FOR UPDATE lock, then recheck status.
-- The definer can lock the parent even when the submitter has no request UPDATE policy.
-- Product-owned photos bypass this request-only guard and retain their existing policies.
create or replace function inventory.guard_product_request_image_insert()
returns trigger language plpgsql security definer set search_path = inventory, public as $$
declare v_status inventory.product_request_status;
begin
  if new.product_request_id is not null then
    if auth.uid() is null or not (inventory.can_manage() or inventory.can_request_add_take()) then
      raise exception 'Product request photo permission required' using errcode='42501';
    end if;
    select r.request_status into v_status from inventory.product_requests r
      where r.id=new.product_request_id for share;
    if not found or v_status is distinct from 'pending_review'::inventory.product_request_status then
      raise exception 'Photos require a pending product request' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function inventory.guard_product_request_image_insert() from public,anon,authenticated,service_role;
drop trigger if exists product_images_guard_request_insert on inventory.product_images;
create trigger product_images_guard_request_insert before insert on inventory.product_images
  for each row execute function inventory.guard_product_request_image_insert();
commit;

-- ROLLBACK (manual). Resolve any zero-quantity adjustment rows before restoring > 0 checks.
-- BEGIN;
-- drop trigger if exists product_images_guard_request_insert on inventory.product_images;
-- drop function if exists inventory.guard_product_request_image_insert();
-- drop function if exists inventory.remove_product(uuid,text);
-- drop function if exists inventory.update_product(uuid,jsonb);
-- drop function if exists inventory.review_product_request(uuid,text,text);
-- drop function if exists inventory.submit_product_request(jsonb);
-- drop function if exists inventory.review_movement_request(uuid,text,text);
-- drop function if exists inventory.submit_movement_request(uuid,text,text,text,text,integer,text);
-- drop function if exists inventory.record_direct_movement(uuid,text,text,text,integer,text);
-- drop function if exists inventory.apply_stock_change(uuid,text,text,text,integer,text,text,uuid,uuid);
-- alter table inventory.movements drop constraint if exists inventory_movements_quantity_positive;
-- alter table inventory.movements add constraint inventory_movements_quantity_positive check (quantity > 0);
-- alter table inventory.movement_requests drop constraint if exists inventory_movement_requests_quantity_positive;
-- alter table inventory.movement_requests add constraint inventory_movement_requests_quantity_positive check (quantity > 0);
-- COMMIT;
