-- Generate stock references only while approving a new product. No existing rows are rewritten.
begin;
create table inventory.stock_ref_counters (
 brand_id uuid primary key references public.brands(id) on delete restrict,
 last_number integer not null default 0
);
alter table inventory.stock_ref_counters enable row level security;
revoke all on inventory.stock_ref_counters from public,anon,authenticated;

-- The upsert locks the brand counter until the surrounding approval commits.
-- A regular transactional counter means failed approvals do not burn numbers.
create function inventory.next_stock_ref(brand_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_code text; v_number integer; v_ref text;
begin
 select b.code into v_code from public.brands b where b.id=$1;
 if nullif(trim(v_code),'') is null then raise exception 'Brand needs a code'; end if;
 loop
  insert into inventory.stock_ref_counters as c(brand_id,last_number) values($1,1)
  on conflict on constraint stock_ref_counters_pkey do update set last_number=c.last_number+1
  returning last_number into v_number;
  v_ref:=v_code||'-'||lpad(v_number::text,greatest(4,length(v_number::text)),'0');
  if not exists(select from inventory.products p where p.is_active and lower(p.stock_ref)=lower(v_ref)) then return v_ref; end if;
 end loop;
end $$;
revoke all on function inventory.next_stock_ref(uuid) from public,anon,authenticated;

alter table inventory.product_requests alter column stock_ref drop not null;
alter table inventory.product_requests drop constraint product_requests_stock_ref_not_blank;
alter table inventory.product_requests add constraint product_requests_stock_ref_not_blank check(stock_ref is null or length(trim(stock_ref))>0);
alter table inventory.products alter column item_code drop not null;
alter table inventory.products drop constraint products_item_code_not_blank;
alter table inventory.products add constraint products_item_code_not_blank check(item_code is null or length(trim(item_code))>0);
alter table inventory.products alter column model_name drop not null;
alter table inventory.products drop constraint products_model_name_not_blank;
alter table inventory.products add constraint products_model_name_not_blank check(model_name is null or length(trim(model_name))>0);
alter table inventory.product_requests alter column item_code drop not null;
alter table inventory.product_requests drop constraint product_requests_item_code_not_blank;
alter table inventory.product_requests add constraint product_requests_item_code_not_blank check(item_code is null or length(trim(item_code))>0);
alter table inventory.product_requests alter column model_name drop not null;
alter table inventory.product_requests drop constraint product_requests_model_name_not_blank;
alter table inventory.product_requests add constraint product_requests_model_name_not_blank check(model_name is null or length(trim(model_name))>0);

create or replace function inventory.submit_product_request_pending(payload jsonb)
returns uuid language plpgsql security definer set search_path = inventory, public as $$
declare
  v_fields jsonb; v_request inventory.product_requests%rowtype; v_costs jsonb; v_id uuid;
begin
  if auth.uid() is null or not (inventory.can_manage() or inventory.can_request_add_take()) then
    raise exception 'Product request permission required' using errcode='42501';
  end if;
  if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Product request must be a JSON object'; end if;
  select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into v_fields from jsonb_each(payload) e
  where e.key=any(array['brand_id','category_id','subcategory_id','custom_category_name','item_code',
    'item_name','model_name','description','quantity','requested_status','condition','source','note',
    'dimension_length','dimension_width','dimension_height','dimension_unit','item_type','initial_stock']);
  v_request:=jsonb_populate_record(null::inventory.product_requests,v_fields);
  if length(trim(v_request.item_code))=0 then v_request.item_code:=null; end if;
  if length(trim(v_request.model_name))=0 then v_request.model_name:=null; end if;
  v_request.stock_ref:=null;
  if v_request.brand_id is null or v_request.category_id is null then raise exception 'Brand and category are required'; end if;
  if coalesce(length(trim(v_request.item_name)),0)=0 then
      raise exception 'Item name is required';
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
    where e.key=any(array['brand_id','category_id','subcategory_id','custom_category_name','item_code','item_name','model_name','description','quantity','requested_status','condition','source','note','dimension_length','dimension_width','dimension_height','dimension_unit','item_type','initial_stock']);
    v_request:=jsonb_populate_record(v_request,v_fields);
    if length(trim(v_request.item_code))=0 then v_request.item_code:=null; end if;
  if length(trim(v_request.model_name))=0 then v_request.model_name:=null; end if;
    if v_request.brand_id is null or v_request.category_id is null then raise exception 'Brand and category are required'; end if;
    if coalesce(length(trim(v_request.item_name)),0)=0 then
      raise exception 'Item name is required'; end if;
    if v_request.quantity is null or v_request.quantity<=0 then raise exception 'Product quantity must be positive'; end if;

    v_request.stock_ref:=inventory.next_stock_ref(v_request.brand_id);
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
  if length(trim(v_product.item_code))=0 then v_product.item_code:=null; end if;
  if length(trim(v_product.model_name))=0 then v_product.model_name:=null; end if;
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

-- CREATE OR REPLACE preserves the established caller ACLs. Pending submission stays internal.
revoke all on function inventory.submit_product_request_pending(jsonb) from public,anon,authenticated;
commit;
