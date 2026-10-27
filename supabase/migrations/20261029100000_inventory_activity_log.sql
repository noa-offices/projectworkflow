-- Inventory activity log: AFTER triggers write fixed-title rows to public.audit_activity_log.
-- Manual application only. Existing inventory functions are NOT changed.
-- Privacy: rows carry only item name, stock ref, quantity, locations, request type, decision,
-- ids and the actor name. Nothing monetary, no free text and no row data is ever written.
-- Skipped on purpose: photos, categories, local brands, stock adjustments.
begin;

-- 1. Helper: one row per call. Actor is auth.uid(); no actor (service role / system) = no row.
--    A logging failure can never block an inventory action.
create or replace function inventory.log_activity(
  p_entity_type text, p_entity_id uuid, p_parent_type text, p_parent_id uuid,
  p_action text, p_title text, p_description text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_name text;
begin
  if v_actor is null then return; end if;
  begin
    select nullif(btrim(p.full_name), '') into v_name from public.profiles p where p.id = v_actor;
    insert into public.audit_activity_log
      (entity_type, entity_id, parent_entity_type, parent_entity_id, action, title, description, metadata, created_by)
    values
      (p_entity_type, p_entity_id, p_parent_type, p_parent_id, p_action, p_title, p_description,
       jsonb_build_object('actorName', coalesce(v_name, 'A team member'), 'module', 'inventory'), v_actor);
  exception when others then null;
  end;
end $$;
revoke all on function inventory.log_activity(text, uuid, text, uuid, text, text, text) from public, anon, authenticated;

-- 2. Label helpers: "Item name (STOCK-REF)".
create or replace function inventory.activity_label(p_name text, p_ref text)
returns text language sql immutable set search_path = '' as $$
  select left(regexp_replace(coalesce(p_name, 'Item'), '\s+', ' ', 'g'), 80)
    || coalesce(' (' || left(regexp_replace(p_ref, '\s+', ' ', 'g'), 40) || ')', '');
$$;
revoke all on function inventory.activity_label(text, text) from public, anon, authenticated;

create or replace function inventory.activity_product_label(p_product_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select inventory.activity_label(p.item_name, p.stock_ref) from inventory.products p where p.id = p_product_id;
$$;
revoke all on function inventory.activity_product_label(uuid) from public, anon, authenticated;

-- 3. Products: added / updated / removed / permanently deleted.
create or replace function inventory.trg_log_product()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_skip text[] := array['quantity','warehouse_quantity','dubai_showroom_quantity','abudhabi_showroom_quantity',
    'mockup_quantity','temporary_out_quantity','sold_quantity','updated_at','updated_by',
    'is_active','removed_at','removed_by','removal_reason'];
begin
  begin
    if tg_op = 'INSERT' then
      perform inventory.log_activity('inventory_product', new.id, null, null, 'inventory_item_added',
        'Inventory item added', inventory.activity_label(new.item_name, new.stock_ref));
    elsif tg_op = 'DELETE' then
      perform inventory.log_activity('inventory_product', old.id, null, null, 'inventory_item_deleted',
        'Inventory item permanently deleted', inventory.activity_label(old.item_name, old.stock_ref));
    elsif old.is_active and not new.is_active then
      perform inventory.log_activity('inventory_product', new.id, null, null, 'inventory_item_removed',
        'Inventory item removed', inventory.activity_label(new.item_name, new.stock_ref));
    elsif new.is_active and (to_jsonb(new) - v_skip) is distinct from (to_jsonb(old) - v_skip) then
      -- Stock-count changes are excluded above: those are logged as stock movements instead.
      perform inventory.log_activity('inventory_product', new.id, null, null, 'inventory_item_updated',
        'Inventory item updated', inventory.activity_label(new.item_name, new.stock_ref));
    end if;
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function inventory.trg_log_product() from public, anon, authenticated;

drop trigger if exists inventory_log_product_ins on inventory.products;
create trigger inventory_log_product_ins after insert on inventory.products
  for each row execute function inventory.trg_log_product();
drop trigger if exists inventory_log_product_upd on inventory.products;
create trigger inventory_log_product_upd after update on inventory.products
  for each row execute function inventory.trg_log_product();
drop trigger if exists inventory_log_product_del on inventory.products;
create trigger inventory_log_product_del after delete on inventory.products
  for each row execute function inventory.trg_log_product();

-- 4. Item requests: requested / approved / rejected.
create or replace function inventory.trg_log_product_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if tg_op = 'INSERT' then
      if new.request_status::text = 'pending_review' then
        perform inventory.log_activity('inventory_request', new.id, null, null, 'inventory_item_requested',
          'Inventory item requested', inventory.activity_label(new.item_name, new.stock_ref));
      end if;
    elsif old.request_status::text = 'pending_review' and new.request_status::text in ('approved', 'rejected') then
      perform inventory.log_activity('inventory_request', new.id, 'inventory_product', new.approved_product_id,
        'inventory_item_request_' || new.request_status::text,
        case new.request_status::text when 'approved' then 'Inventory item request approved'
          else 'Inventory item request rejected' end,
        inventory.activity_label(new.item_name, new.stock_ref));
    end if;
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function inventory.trg_log_product_request() from public, anon, authenticated;

drop trigger if exists inventory_log_product_request_ins on inventory.product_requests;
create trigger inventory_log_product_request_ins after insert on inventory.product_requests
  for each row execute function inventory.trg_log_product_request();
drop trigger if exists inventory_log_product_request_upd on inventory.product_requests;
create trigger inventory_log_product_request_upd after update on inventory.product_requests
  for each row execute function inventory.trg_log_product_request();

-- 5. Stock movements: added / taken / moved (stock adjustments are not logged).
create or replace function inventory.trg_log_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text;
begin
  begin
    v_title := case new.movement_type::text
      when 'stock_in' then 'Inventory stock added'
      when 'stock_out' then 'Inventory stock taken'
      when 'transfer' then 'Inventory stock moved'
      else null end;
    if v_title is not null then
      perform inventory.log_activity('inventory_movement', new.id, 'inventory_product', new.product_id,
        'inventory_' || new.movement_type::text, v_title,
        coalesce(inventory.activity_product_label(new.product_id), 'Item') || ' - quantity ' || new.quantity::text
          || coalesce(', from ' || replace(new.from_location, '_', ' '), '')
          || coalesce(', to ' || replace(new.to_location, '_', ' '), ''));
    end if;
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function inventory.trg_log_movement() from public, anon, authenticated;

drop trigger if exists inventory_log_movement_ins on inventory.movements;
create trigger inventory_log_movement_ins after insert on inventory.movements
  for each row execute function inventory.trg_log_movement();

-- 6. Stock requests: submitted / approved / rejected.
create or replace function inventory.trg_log_movement_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_desc text;
begin
  begin
    v_desc := coalesce(inventory.activity_product_label(new.product_id), 'Item') || ' - ' || new.request_type
      || ' request, quantity ' || new.quantity::text;
    if tg_op = 'INSERT' then
      if new.request_status::text = 'pending_review' then
        perform inventory.log_activity('inventory_request', new.id, 'inventory_product', new.product_id,
          'inventory_stock_request_submitted', 'Inventory stock request submitted', v_desc);
      end if;
    elsif old.request_status::text = 'pending_review' and new.request_status::text in ('approved', 'rejected') then
      perform inventory.log_activity('inventory_request', new.id, 'inventory_product', new.product_id,
        'inventory_stock_request_' || new.request_status::text,
        case new.request_status::text when 'approved' then 'Inventory stock request approved'
          else 'Inventory stock request rejected' end, v_desc);
    end if;
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function inventory.trg_log_movement_request() from public, anon, authenticated;

drop trigger if exists inventory_log_movement_request_ins on inventory.movement_requests;
create trigger inventory_log_movement_request_ins after insert on inventory.movement_requests
  for each row execute function inventory.trg_log_movement_request();
drop trigger if exists inventory_log_movement_request_upd on inventory.movement_requests;
create trigger inventory_log_movement_request_upd after update on inventory.movement_requests
  for each row execute function inventory.trg_log_movement_request();

-- 7. Reservations: held / booked, then released / fulfilled.
create or replace function inventory.trg_log_reservation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_desc text;
begin
  begin
    v_desc := coalesce(inventory.activity_product_label(new.product_id), 'Item') || ' - quantity ' || new.quantity::text;
    if tg_op = 'INSERT' then
      perform inventory.log_activity('inventory_movement', new.id, 'inventory_product', new.product_id,
        'inventory_stock_' || new.kind,
        case new.kind when 'hold' then 'Inventory stock held' else 'Inventory stock booked' end, v_desc);
    elsif old.status = 'active' and new.status in ('released', 'fulfilled') then
      perform inventory.log_activity('inventory_movement', new.id, 'inventory_product', new.product_id,
        'inventory_reservation_' || new.status,
        case new.status when 'released' then 'Inventory reservation released'
          else 'Inventory reservation fulfilled' end, v_desc);
    end if;
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function inventory.trg_log_reservation() from public, anon, authenticated;

drop trigger if exists inventory_log_reservation_ins on inventory.reservations;
create trigger inventory_log_reservation_ins after insert on inventory.reservations
  for each row execute function inventory.trg_log_reservation();
drop trigger if exists inventory_log_reservation_upd on inventory.reservations;
create trigger inventory_log_reservation_upd after update on inventory.reservations
  for each row execute function inventory.trg_log_reservation();

commit;
