-- Task 11: manual application only. Archive/remove_product is deliberately unchanged.
begin;
create function inventory.get_product_delete_summary(product_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_ref text;
begin
 if auth.uid() is null or not coalesce(inventory.can_manage(),false) then raise exception 'Inventory management permission required' using errcode='42501'; end if;
 select p.stock_ref into v_ref from inventory.products p where p.id=$1;
 if not found then raise exception 'Product not found'; end if;
 return jsonb_build_object('stock_ref',v_ref,
  'photos',(select count(*) from inventory.product_images i where i.product_id=$1 or i.product_request_id in (select r.id from inventory.product_requests r where r.approved_product_id=$1)),
  'movements',(select count(*) from inventory.movements m where m.product_id=$1),
  'reservations',(select count(*) from inventory.reservations r where r.product_id=$1));
end $$;
revoke all on function inventory.get_product_delete_summary(uuid) from public,anon,authenticated,service_role;
grant execute on function inventory.get_product_delete_summary(uuid) to authenticated;

create function inventory.delete_product_permanently(product_id uuid)
returns text[] language plpgsql security definer set search_path='' as $$
declare v_requests uuid[]; v_paths text[];
begin
 if auth.uid() is null or not coalesce(inventory.can_manage(),false) then raise exception 'Inventory management permission required' using errcode='42501'; end if;
 -- Audit every incoming product FK, including CASCADE/SET NULL, before any mutation.
 -- Fail closed if a future schema adds a reference this explicit cleanup does not handle.
 if exists (
  select from pg_catalog.pg_constraint c
  left join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.confrelid='inventory.products'::regclass
   and (cardinality(c.conkey)<>1 or (c.conrelid::regclass::text||'.'||a.attname) not in (
    'inventory.product_costs.product_id','inventory.product_images.product_id','inventory.product_requests.approved_product_id',
    'inventory.movements.product_id','inventory.movement_requests.product_id','inventory.reservations.product_id'))
 ) then raise exception 'Product has an unsupported dependency; deletion was not performed'; end if;
 -- Blocks new direct dependents and serializes with every supported stock operation.
 perform 1 from inventory.products p where p.id=$1 for update;
 if not found then raise exception 'Product not found'; end if;
 -- Block new indirect dependents while gathering the complete request/photo set.
 perform 1 from inventory.product_requests r where r.approved_product_id=$1 order by r.id for update;
 select coalesce(array_agg(r.id),'{}'::uuid[]) into v_requests from inventory.product_requests r where r.approved_product_id=$1;
 perform 1 from inventory.movement_requests r where r.product_id=$1 order by r.id for update;
 perform 1 from inventory.reservations r where r.product_id=$1 order by r.id for update;
 perform 1 from inventory.movements m where m.product_id=$1 order by m.id for update;
 -- Cross-item links are inconsistent data. Never let SET NULL modify another item.
 if exists(select from inventory.movement_requests r where r.product_id<>$1 and (
   r.approved_movement_id in (select m.id from inventory.movements m where m.product_id=$1) or
   r.approved_reservation_id in (select h.id from inventory.reservations h where h.product_id=$1)))
 or exists(select from inventory.reservations r where r.product_id<>$1 and (
   r.source_request_id in (select q.id from inventory.movement_requests q where q.product_id=$1) or
   r.fulfilled_movement_id in (select m.id from inventory.movements m where m.product_id=$1)))
 then raise exception 'This item has history linked to another item; deletion was not performed'; end if;
 -- Shared objects stay in Storage. Only exclusive inventory-images paths are returned.
 select coalesce(array_agg(p.storage_path order by p.storage_path),'{}'::text[]) into v_paths from (
  select distinct i.storage_path from inventory.product_images i
  where i.storage_bucket='inventory-images' and (i.product_id=$1 or i.product_request_id=any(v_requests))
  and not exists(select from inventory.product_images other where other.storage_bucket=i.storage_bucket and other.storage_path=i.storage_path
   and not (coalesce(other.product_id=$1,false) or coalesce(other.product_request_id=any(v_requests),false)))
 ) p;
 -- Explicitly handle all six incoming product FKs plus request-owned rows.
 delete from inventory.product_images i where i.product_id=$1 or i.product_request_id=any(v_requests);
 delete from inventory.product_request_costs c where c.product_request_id=any(v_requests);
 -- Break the reservation/request cycle only on rows owned by this item, before deletion.
 update inventory.movement_requests r set approved_reservation_id=null,approved_movement_id=null where r.product_id=$1;
 delete from inventory.reservations r where r.product_id=$1;
 delete from inventory.movement_requests r where r.product_id=$1;
 delete from inventory.movements m where m.product_id=$1;
 delete from inventory.product_requests r where r.id=any(v_requests);
 delete from inventory.product_costs c where c.product_id=$1;
 delete from inventory.products p where p.id=$1;
 -- No counter updates, notifications, public-table writes or Storage mutations.
 return v_paths;
end $$;
revoke all on function inventory.delete_product_permanently(uuid) from public,anon,authenticated,service_role;
grant execute on function inventory.delete_product_permanently(uuid) to authenticated;
commit;
