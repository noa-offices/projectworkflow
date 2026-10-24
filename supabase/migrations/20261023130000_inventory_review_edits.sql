-- Review edits and initial stock are atomic with the existing approval workflow.
begin;
alter table inventory.product_requests add column initial_stock jsonb;
create function inventory.valid_initial_stock(stock jsonb, quantity integer)
returns boolean language plpgsql immutable set search_path = '' as $$
declare e record; total numeric:=0;
begin
 if stock is null then return true; end if;
 if jsonb_typeof(stock)<>'object' then return false; end if;
 for e in select key,value from jsonb_each(stock) loop
   if e.key not in ('warehouse','dubai_showroom','abudhabi_showroom','mockup','temporary_out')
     or jsonb_typeof(e.value)<>'number' or e.value::text !~ '^[0-9]+$' then return false; end if;
   total:=total+e.value::text::numeric;
 end loop;
 return total=quantity;
end $$;
revoke all on function inventory.valid_initial_stock(jsonb,integer) from public,anon;
grant execute on function inventory.valid_initial_stock(jsonb,integer) to authenticated,service_role;
alter table inventory.product_requests add constraint product_requests_initial_stock_valid check(inventory.valid_initial_stock(initial_stock,quantity));
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
      v_target := array_position(v_locations,coalesce(p_to,'warehouse'));
      if v_target is null then raise exception 'Destination must be a live location'; end if;
      v_buckets[v_target] := v_buckets[v_target] + p_quantity;
      v_type := 'stock_in'; v_from := null; v_to := coalesce(p_to,'warehouse');
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
    'dimension_length','dimension_width','dimension_height','dimension_unit','item_type','initial_stock']);
  v_request:=jsonb_populate_record(null::inventory.product_requests,v_fields);
  if v_request.brand_id is null or v_request.category_id is null then raise exception 'Brand and category are required'; end if;
  if coalesce(length(trim(v_request.stock_ref)),0)=0 or coalesce(length(trim(v_request.item_code)),0)=0
    or coalesce(length(trim(v_request.item_name)),0)=0 or coalesce(length(trim(v_request.model_name)),0)=0 then
    raise exception 'Stock ref, item code, item name and model name are required';
  end if;
  if v_request.quantity is null or v_request.quantity<=0 then raise exception 'Product quantity must be positive'; end if;
  insert into inventory.product_requests(brand_id,category_id,subcategory_id,custom_category_name,stock_ref,
    item_code,item_name,model_name,description,quantity,requested_status,condition,source,note,
    dimension_length,dimension_width,dimension_height,dimension_unit,item_type,initial_stock,submitted_by,request_status)
  values(v_request.brand_id,v_request.category_id,v_request.subcategory_id,v_request.custom_category_name,v_request.stock_ref,
    v_request.item_code,v_request.item_name,v_request.model_name,v_request.description,v_request.quantity,
    coalesce(v_request.requested_status,'available'),coalesce(v_request.condition,'new'),coalesce(v_request.source,'manual_entry'),v_request.note,
    v_request.dimension_length,v_request.dimension_width,v_request.dimension_height,v_request.dimension_unit,
    coalesce(v_request.item_type,'product'),coalesce(v_request.initial_stock,jsonb_build_object('warehouse',v_request.quantity)),auth.uid(),'pending_review') returning id into v_id;
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
create or replace function inventory.review_product_request_with_edits(request_id uuid, decision text, review_note text, edits jsonb)
returns uuid language plpgsql security definer set search_path = inventory, public as $$
declare
  p_id alias for $1; p_decision alias for $2; p_note alias for $3;
  v_request inventory.product_requests%rowtype; v_product uuid; v_constraint text; v_fields jsonb; v_costs jsonb; v_bucket record;
begin
  if auth.uid() is null or not inventory.can_manage() then raise exception 'Inventory management permission required' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  select r.* into v_request from inventory.product_requests r where r.id=p_id for update;
  if not found then raise exception 'Product request not found'; end if;
  if v_request.request_status<>'pending_review' then raise exception 'Request has already been reviewed'; end if;
  if p_decision='approved' then
    if edits is null or jsonb_typeof(edits)<>'object' then raise exception 'Edits must be a JSON object'; end if;
    select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into v_fields from jsonb_each(edits) e
    where e.key=any(array['brand_id','category_id','subcategory_id','custom_category_name','stock_ref','item_code','item_name','model_name','description','quantity','requested_status','condition','source','note','dimension_length','dimension_width','dimension_height','dimension_unit','item_type','initial_stock']);
    v_request:=jsonb_populate_record(v_request,v_fields);
    if v_request.brand_id is null or v_request.category_id is null then raise exception 'Brand and category are required'; end if;
    if coalesce(length(trim(v_request.stock_ref)),0)=0 or coalesce(length(trim(v_request.item_code)),0)=0
      or coalesce(length(trim(v_request.item_name)),0)=0 or coalesce(length(trim(v_request.model_name)),0)=0 then
      raise exception 'Stock ref, item code, item name and model name are required'; end if;
    if v_request.quantity is null or v_request.quantity<=0 then raise exception 'Product quantity must be positive'; end if;

    update inventory.product_requests r set brand_id=v_request.brand_id,category_id=v_request.category_id,subcategory_id=v_request.subcategory_id,custom_category_name=v_request.custom_category_name,stock_ref=v_request.stock_ref,item_code=v_request.item_code,item_name=v_request.item_name,model_name=v_request.model_name,description=v_request.description,quantity=v_request.quantity,requested_status=v_request.requested_status,condition=v_request.condition,source=v_request.source,note=v_request.note,dimension_length=v_request.dimension_length,dimension_width=v_request.dimension_width,dimension_height=v_request.dimension_height,dimension_unit=v_request.dimension_unit,item_type=v_request.item_type,initial_stock=v_request.initial_stock where r.id=p_id;
    if edits ? 'costs' then
      v_costs:=edits->'costs';
      if jsonb_typeof(v_costs)<>'object' then raise exception 'Costs must be a JSON object'; end if;
      insert into inventory.product_request_costs as c(product_request_id,price,freight_cost,c_and_f,transport,custom_duty,labour,vat)
      values(p_id,coalesce((v_costs->>'price')::numeric,0),coalesce((v_costs->>'freight_cost')::numeric,0),coalesce((v_costs->>'c_and_f')::numeric,0),coalesce((v_costs->>'transport')::numeric,0),coalesce((v_costs->>'custom_duty')::numeric,0),coalesce((v_costs->>'labour')::numeric,0),coalesce((v_costs->>'vat')::numeric,0)) on conflict(product_request_id) do update set price=case when v_costs ? 'price' then excluded.price else c.price end,freight_cost=case when v_costs ? 'freight_cost' then excluded.freight_cost else c.freight_cost end,c_and_f=case when v_costs ? 'c_and_f' then excluded.c_and_f else c.c_and_f end,transport=case when v_costs ? 'transport' then excluded.transport else c.transport end,custom_duty=case when v_costs ? 'custom_duty' then excluded.custom_duty else c.custom_duty end,labour=case when v_costs ? 'labour' then excluded.labour else c.labour end,vat=case when v_costs ? 'vat' then excluded.vat else c.vat end;
    end if;
    insert into inventory.products(brand_id,category_id,subcategory_id,custom_category_name,stock_ref,item_code,
      item_name,model_name,description,status,condition,source,note,dimension_length,dimension_width,dimension_height,
      dimension_unit,item_type,created_by,updated_by)
    values(v_request.brand_id,v_request.category_id,v_request.subcategory_id,v_request.custom_category_name,
      v_request.stock_ref,v_request.item_code,v_request.item_name,v_request.model_name,v_request.description,
      v_request.requested_status,v_request.condition,v_request.source,v_request.note,v_request.dimension_length,
      v_request.dimension_width,v_request.dimension_height,v_request.dimension_unit,v_request.item_type,auth.uid(),auth.uid()) returning id into v_product;
    for v_bucket in select key,value from jsonb_each_text(coalesce(v_request.initial_stock,jsonb_build_object('warehouse',v_request.quantity))) loop
      if v_bucket.value::integer>0 then
        perform inventory.apply_stock_change(v_product,'receive_stock',null,v_bucket.key,v_bucket.value::integer,
          v_request.note,'product_request',v_request.id,auth.uid());
      end if;
    end loop;
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
revoke execute on function inventory.review_product_request_with_edits(uuid,text,text,jsonb) from public,anon;
grant execute on function inventory.review_product_request_with_edits(uuid,text,text,jsonb) to authenticated,service_role;
create or replace function inventory.review_product_request(request_id uuid, decision text, review_note text)
returns uuid language sql security definer set search_path = inventory, public as $$
 select inventory.review_product_request_with_edits(request_id,decision,review_note,'{}'::jsonb);
$$;
revoke all on function inventory.review_product_request(uuid,text,text) from public,anon;
grant execute on function inventory.review_product_request(uuid,text,text) to authenticated,service_role;
commit;
