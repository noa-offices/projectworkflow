-- Reservations share the product-row lock with every stock mutation.
begin;
create table inventory.reservations (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references inventory.products(id) on delete restrict,
 kind text not null check(kind in ('hold','book')),
 quantity integer not null check(quantity>0),
 status text not null default 'active' check(status in ('active','released','fulfilled')),
 project_id uuid references public.projects(id) on delete set null,
 project_label text, reference_note text, expires_at timestamptz, note text,
 created_by uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now(),
 source_request_id uuid references inventory.movement_requests(id) on delete set null,
 released_by uuid references public.profiles(id), released_at timestamptz, release_note text,
 fulfilled_movement_id uuid references inventory.movements(id) on delete set null
);
create index reservations_active_product_idx on inventory.reservations(product_id) where status='active';
create unique index reservations_source_request_idx on inventory.reservations(source_request_id) where source_request_id is not null;
alter table inventory.reservations enable row level security;
create policy reservations_select on inventory.reservations for select to authenticated using(inventory.can_view());
revoke all on inventory.reservations from public,anon,authenticated,service_role;
grant select on inventory.reservations to authenticated;
alter table inventory.movement_requests
 add column project_id uuid references public.projects(id) on delete set null,
 add column project_label text, add column reference_note text, add column expires_at timestamptz,
 add column approved_reservation_id uuid references inventory.reservations(id) on delete set null;
create function inventory.reserved_quantity(product_id uuid) returns bigint language sql stable security definer set search_path=inventory,public as $$
 select coalesce(sum(r.quantity),0) from inventory.reservations r
 where auth.uid() is not null and inventory.can_view() and r.product_id=$1 and r.status='active' and (r.expires_at is null or r.expires_at>now());
$$;
revoke all on function inventory.reserved_quantity(uuid) from public,anon;
grant execute on function inventory.reserved_quantity(uuid) to authenticated,service_role;
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
  v_from text := p_from; v_to text := p_to; v_reserved bigint;
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
  v_reserved:=inventory.reserved_quantity(p_product_id);
  if p_action in ('sale','internal_transfer','return_to_warehouse') and p_quantity>v_product.quantity-v_reserved then
    raise exception 'Only % units are available; % are reserved',v_product.quantity-v_reserved,v_reserved;
  end if;
  if p_action='adjustment' and p_quantity<v_reserved then raise exception 'Release reservations first'; end if;
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
-- Caller is a manager reviewing a locked request; creator remains the submitter.
create function inventory.create_request_reservation(request_id uuid) returns uuid language plpgsql security definer set search_path=inventory,public as $$
declare r inventory.movement_requests%rowtype; p inventory.products%rowtype; reserved bigint; result uuid;
begin
 if auth.uid() is null or not inventory.can_manage() then raise exception 'Inventory management permission required' using errcode='42501'; end if;
 select * into r from inventory.movement_requests where id=$1 for update;
 if not found or r.request_status<>'pending_review' or r.request_type not in ('hold','book') then raise exception 'Pending reservation request required'; end if;
 select * into p from inventory.products where id=r.product_id for update;
 if not found or not p.is_active then raise exception 'Active product not found'; end if;
 if r.expires_at is not null and r.expires_at<=now() then raise exception 'Hold until must be in the future'; end if;
 reserved:=inventory.reserved_quantity(r.product_id);
 if r.quantity>p.quantity-reserved then raise exception 'Only % units are available; % are reserved',p.quantity-reserved,reserved; end if;
 insert into inventory.reservations(product_id,kind,quantity,project_id,project_label,reference_note,expires_at,note,created_by,source_request_id)
 values(r.product_id,r.request_type,r.quantity,r.project_id,r.project_label,r.reference_note,r.expires_at,r.note,r.submitted_by,r.id) returning id into result;
 return result;
end $$;
revoke all on function inventory.create_request_reservation(uuid) from public,anon,authenticated,service_role;
create or replace function inventory.review_movement_request(request_id uuid, decision text, review_note text)
returns void language plpgsql security definer set search_path = inventory, public as $$
declare
  p_id alias for $1; p_decision alias for $2; p_note alias for $3;
  v_request inventory.movement_requests%rowtype; v_movement uuid; v_reservation uuid;
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
  if p_decision='approved' and v_request.request_type in ('hold','book') then
    v_reservation:=inventory.create_request_reservation(p_id);
  end if;
  update inventory.movement_requests r set request_status=p_decision::inventory.product_request_status,
    reviewed_by=auth.uid(),reviewed_at=now(),review_note=p_note,approved_movement_id=v_movement,approved_reservation_id=v_reservation where r.id=p_id;
end $$;
revoke execute on function inventory.review_movement_request(uuid,text,text) from public,anon;
grant execute on function inventory.review_movement_request(uuid,text,text) to authenticated,service_role;
drop function inventory.submit_movement_request(uuid,text,text,text,text,integer,text);
create function inventory.submit_movement_request(
 product_id uuid,request_type text,action_type text,from_location text,to_location text,quantity integer,note text,
 project_id uuid default null,reference_note text default null,expires_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path=inventory,public as $$
declare r uuid; m uuid; reservation uuid; label text; stock integer; reserved bigint;
begin
 if auth.uid() is null or not (inventory.can_manage()
  or (inventory.can_request_hold_book() and request_type in ('hold','book'))
  or (inventory.can_request_add_take() and request_type in ('take','move'))) then
  raise exception 'Movement request permission required' using errcode='42501'; end if;
 if request_type in ('hold','book') then
   if quantity is null or quantity<=0 then raise exception 'Quantity must be positive'; end if;
   if request_type='book' and project_id is null and coalesce(btrim(reference_note),'')='' then raise exception 'Book requires a project or reference'; end if;
   if expires_at is not null and (request_type<>'hold' or expires_at<=now()) then raise exception 'Hold until must be in the future and is only allowed for holds'; end if;
 elsif project_id is not null or reference_note is not null or expires_at is not null then
   raise exception 'Project, reference and hold until are only allowed for hold/book';
 end if;
 if project_id is not null then
   -- Match projects_select_active / projects_select_managers explicitly: the
   -- definer must not treat its own bypass-RLS identity as caller visibility.
   select concat_ws(' - ',p.project_number,p.project_name,
     case when (c.is_active and public.current_user_is_active()) or public.current_user_can_manage_settings() then c.company_name end)
   into label from public.projects p left join public.clients c on c.id=p.client_id
   where p.id=$8 and ((p.is_active and public.current_user_is_active()) or public.current_user_can_manage_settings());
   if not found then raise exception 'Project not found or not accessible' using errcode='42501'; end if;
 end if;
 -- FOR UPDATE serializes submissions with approvals, release, fulfil and stock changes.
 select p.quantity into stock from inventory.products p where p.id=$1 and p.is_active for update;
 if not found then raise exception 'Active product not found'; end if;
 reserved:=inventory.reserved_quantity($1);
 if request_type in ('hold','book') and quantity>stock-reserved then
   raise exception 'Only % units are available; % are reserved',stock-reserved,reserved;
 end if;
 r:=inventory.submit_movement_request_pending($1,$2,$3,$4,$5,$6,$7);
 update inventory.movement_requests mr set project_id=$8,project_label=label,reference_note=nullif(btrim($9),''),expires_at=$10 where mr.id=r;
 if inventory.can_manage() then
   perform inventory.review_movement_request(r,'approved','Applied directly by manager');
   select approved_movement_id,approved_reservation_id into m,reservation from inventory.movement_requests where id=r;
 end if;
 return jsonb_build_object('request_id',r,'movement_id',m,'reservation_id',reservation);
end $$;
revoke all on function inventory.submit_movement_request(uuid,text,text,text,text,integer,text,uuid,text,timestamptz) from public,anon;
grant execute on function inventory.submit_movement_request(uuid,text,text,text,text,integer,text,uuid,text,timestamptz) to authenticated,service_role;
create function inventory.release_reservation(reservation_id uuid,note text) returns void language plpgsql security definer set search_path=inventory,public as $$
declare r inventory.reservations%rowtype; pid uuid;
begin
 if auth.uid() is null or not inventory.can_view() then raise exception 'Reservation release permission required' using errcode='42501'; end if;
 select product_id into pid from inventory.reservations where id=$1;
 perform 1 from inventory.products where id=pid for update;
 select * into r from inventory.reservations where id=$1 for update;
 if not found then raise exception 'Reservation not found'; end if;
 if not inventory.can_manage() and r.created_by<>auth.uid() then raise exception 'Reservation release permission required' using errcode='42501'; end if;
 if r.status<>'active' then raise exception 'Reservation is no longer active'; end if;
 update inventory.reservations set status='released',released_by=auth.uid(),released_at=now(),release_note=$2 where id=$1;
end $$;
revoke all on function inventory.release_reservation(uuid,text) from public,anon;
grant execute on function inventory.release_reservation(uuid,text) to authenticated,service_role;
create function inventory.fulfil_reservation(reservation_id uuid,action_type text,from_location text,to_location text,note text)
returns uuid language plpgsql security definer set search_path=inventory,public as $$
declare r inventory.reservations%rowtype; pid uuid; movement uuid;
begin
 if auth.uid() is null or not inventory.can_manage() then raise exception 'Inventory management permission required' using errcode='42501'; end if;
 if action_type is null or action_type not in ('sale','internal_transfer') then raise exception 'Fulfil requires sale or internal transfer'; end if;
 select product_id into pid from inventory.reservations where id=$1;
 perform 1 from inventory.products where id=pid for update;
 select * into r from inventory.reservations where id=$1 for update;
 if not found then raise exception 'Reservation not found'; end if;
 if r.status<>'active' or (r.expires_at is not null and r.expires_at<=now()) then raise exception 'Reservation is no longer active'; end if;
 -- Exclude only this reservation while holding the shared product mutex. Any
 -- failure in the stock writer rolls this transition back in the same statement.
 update inventory.reservations set status='fulfilled' where id=$1;
 movement:=inventory.apply_stock_change(r.product_id,$2,$3,$4,r.quantity,$5,'manual',r.id,auth.uid());
 update inventory.reservations set fulfilled_movement_id=movement where id=$1;
 return movement;
end $$;
revoke all on function inventory.fulfil_reservation(uuid,text,text,text,text) from public,anon;
grant execute on function inventory.fulfil_reservation(uuid,text,text,text,text) to authenticated,service_role;
commit;
