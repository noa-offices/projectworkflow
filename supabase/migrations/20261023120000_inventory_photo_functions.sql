-- Manager-only photo metadata operations. Object cleanup belongs to the caller.
-- Parent locks serialize owner operations with request review and request-photo INSERTs.
begin;

-- NULLs remain distinct, preserving the former partial indexes' owner semantics.
-- Defer only these two constraints while swapping/compacting slots within 0..2.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='inventory.product_images'::regclass
    and conname='product_images_product_sort_order_key') then
    drop index if exists inventory.product_images_product_sort_order_key;
    alter table inventory.product_images add constraint product_images_product_sort_order_key
      unique(product_id,sort_order) deferrable initially immediate;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='inventory.product_images'::regclass
    and conname='product_images_request_sort_order_key') then
    drop index if exists inventory.product_images_request_sort_order_key;
    alter table inventory.product_images add constraint product_images_request_sort_order_key
      unique(product_request_id,sort_order) deferrable initially immediate;
  end if;
end $$;

create or replace function inventory.set_main_product_photo(photo_id uuid)
returns void language plpgsql security definer set search_path = inventory, public as $$
declare
  p_id alias for $1;
  v_photo inventory.product_images%rowtype;
  v_current inventory.product_images%rowtype;
begin
  if auth.uid() is null or not inventory.can_manage() then
    raise exception 'Inventory management permission required' using errcode='42501';
  end if;
  -- Read ownership without a photo lock: always lock the parent FIRST.
  select i.* into v_photo from inventory.product_images i where i.id=p_id;
  if not found then raise exception 'Photo not found'; end if;
  if v_photo.product_id is not null then
    perform 1 from inventory.products p where p.id=v_photo.product_id for update;
  else
    perform 1 from inventory.product_requests r where r.id=v_photo.product_request_id for update;
  end if;
  if not found then raise exception 'Photo owner not found'; end if;
  perform i.id from inventory.product_images i
    where (v_photo.product_id is not null and i.product_id=v_photo.product_id)
       or (v_photo.product_request_id is not null and i.product_request_id=v_photo.product_request_id)
    order by i.id for update;
  -- Request approval may have relinked this image while the parent lock waited.
  select i.* into v_current from inventory.product_images i where i.id=p_id;
  if not found then raise exception 'Photo not found'; end if;
  if v_current.product_id is distinct from v_photo.product_id
     or v_current.product_request_id is distinct from v_photo.product_request_id then
    raise exception 'Photo ownership changed; retry the operation';
  end if;
  set constraints inventory.product_images_product_sort_order_key,
    inventory.product_images_request_sort_order_key deferred;
  -- Clear the immediate partial main index and main-is-first CHECK before moving slots.
  update inventory.product_images i set is_main=false where (v_photo.product_id is not null and i.product_id=v_photo.product_id)
       or (v_photo.product_request_id is not null and i.product_request_id=v_photo.product_request_id);
  update inventory.product_images i set sort_order=case
    when i.id=p_id then 0 else v_current.sort_order end
    where ((v_photo.product_id is not null and i.product_id=v_photo.product_id)
       or (v_photo.product_request_id is not null and i.product_request_id=v_photo.product_request_id)) and (i.id=p_id or i.sort_order=0);
  update inventory.product_images i set is_main=true where i.id=p_id;
  set constraints inventory.product_images_product_sort_order_key,
    inventory.product_images_request_sort_order_key immediate;
end $$;
revoke execute on function inventory.set_main_product_photo(uuid) from public,anon;
grant execute on function inventory.set_main_product_photo(uuid) to authenticated,service_role;

create or replace function inventory.remove_product_photo(photo_id uuid)
returns text language plpgsql security definer set search_path = inventory, public as $$
declare
  p_id alias for $1;
  v_photo inventory.product_images%rowtype;
  v_current inventory.product_images%rowtype;
  v_main uuid;
begin
  if auth.uid() is null or not inventory.can_manage() then
    raise exception 'Inventory management permission required' using errcode='42501';
  end if;
  -- Read ownership without a photo lock: always lock the parent FIRST.
  select i.* into v_photo from inventory.product_images i where i.id=p_id;
  if not found then raise exception 'Photo not found'; end if;
  if v_photo.product_id is not null then
    perform 1 from inventory.products p where p.id=v_photo.product_id for update;
  else
    perform 1 from inventory.product_requests r where r.id=v_photo.product_request_id for update;
  end if;
  if not found then raise exception 'Photo owner not found'; end if;
  perform i.id from inventory.product_images i
    where (v_photo.product_id is not null and i.product_id=v_photo.product_id)
       or (v_photo.product_request_id is not null and i.product_request_id=v_photo.product_request_id)
    order by i.id for update;
  -- Request approval may have relinked this image while the parent lock waited.
  select i.* into v_current from inventory.product_images i where i.id=p_id;
  if not found then raise exception 'Photo not found'; end if;
  if v_current.product_id is distinct from v_photo.product_id
     or v_current.product_request_id is distinct from v_photo.product_request_id then
    raise exception 'Photo ownership changed; retry the operation';
  end if;
  set constraints inventory.product_images_product_sort_order_key,
    inventory.product_images_request_sort_order_key deferred;
  select i.id into v_main from inventory.product_images i where ((v_photo.product_id is not null and i.product_id=v_photo.product_id)
       or (v_photo.product_request_id is not null and i.product_request_id=v_photo.product_request_id)) and i.is_main;
  delete from inventory.product_images i where i.id=p_id;
  if v_current.is_main then
    select i.id into v_main from inventory.product_images i where (v_photo.product_id is not null and i.product_id=v_photo.product_id)
       or (v_photo.product_request_id is not null and i.product_request_id=v_photo.product_request_id)
      order by i.sort_order,i.id limit 1;
  end if;
  update inventory.product_images i set is_main=false where (v_photo.product_id is not null and i.product_id=v_photo.product_id)
       or (v_photo.product_request_id is not null and i.product_request_id=v_photo.product_request_id);
  with ranked as (
    select i.id,(row_number() over(order by i.sort_order,i.id)-1)::smallint slot
    from inventory.product_images i where (v_photo.product_id is not null and i.product_id=v_photo.product_id)
       or (v_photo.product_request_id is not null and i.product_request_id=v_photo.product_request_id)
  )
  update inventory.product_images i set sort_order=ranked.slot from ranked where i.id=ranked.id;
  update inventory.product_images i set is_main=true where i.id=v_main;
  set constraints inventory.product_images_product_sort_order_key,
    inventory.product_images_request_sort_order_key immediate;
  return v_current.storage_path;
end $$;
revoke execute on function inventory.remove_product_photo(uuid) from public,anon;
grant execute on function inventory.remove_product_photo(uuid) to authenticated,service_role;
commit;

-- ROLLBACK (manual).
-- BEGIN;
-- drop function if exists inventory.set_main_product_photo(uuid);
-- drop function if exists inventory.remove_product_photo(uuid);
-- alter table inventory.product_images drop constraint if exists product_images_product_sort_order_key;
-- alter table inventory.product_images drop constraint if exists product_images_request_sort_order_key;
-- create unique index if not exists product_images_product_sort_order_key on inventory.product_images(product_id,sort_order) where product_id is not null;
-- create unique index if not exists product_images_request_sort_order_key on inventory.product_images(product_request_id,sort_order) where product_request_id is not null;
-- COMMIT;
