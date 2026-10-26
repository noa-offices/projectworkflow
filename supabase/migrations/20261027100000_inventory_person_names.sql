-- Task 16: let every Inventory role see the names of people who appear in Inventory records.
-- public.profiles stays locked to own row + System Owner. These two functions return ONLY id and full_name,
-- and only for people who acted on an Inventory record, so they cannot browse the staff directory.

-- Internal check. Not callable by any API role; only the two SECURITY DEFINER functions below use it.
create or replace function inventory.is_record_actor(p_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_id is not null and (
    exists (select 1 from inventory.products where created_by = p_id)
    or exists (select 1 from inventory.products where updated_by = p_id)
    or exists (select 1 from inventory.products where removed_by = p_id)
    or exists (select 1 from inventory.product_requests where submitted_by = p_id)
    or exists (select 1 from inventory.product_requests where reviewed_by = p_id)
    or exists (select 1 from inventory.product_images where uploaded_by = p_id)
    or exists (select 1 from inventory.movements where created_by = p_id)
    or exists (select 1 from inventory.movement_requests where submitted_by = p_id)
    or exists (select 1 from inventory.movement_requests where reviewed_by = p_id)
    or exists (select 1 from inventory.reservations where created_by = p_id)
    or exists (select 1 from inventory.reservations where released_by = p_id)
    or exists (select 1 from inventory.local_brands where created_by = p_id)
  );
$$;
revoke all on function inventory.is_record_actor(uuid) from public, anon, authenticated, service_role;

-- Names for up to 200 ids. People without Inventory activity are simply not returned.
create or replace function inventory.person_names(p_ids uuid[])
returns table (id uuid, full_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not coalesce(inventory.can_view(), false) then
    raise exception 'Inventory access denied' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ids), 0) > 200 then
    raise exception 'At most 200 ids per call' using errcode = '22023';
  end if;
  return query
    select p.id, p.full_name
    from public.profiles p
    where p.id = any (p_ids) and inventory.is_record_actor(p.id);
end;
$$;
revoke all on function inventory.person_names(uuid[]) from public, anon, authenticated, service_role;
grant execute on function inventory.person_names(uuid[]) to authenticated;

-- Person search: case-insensitive, at least 2 characters, % _ and \ are matched literally, at most 100 ids.
create or replace function inventory.search_people(term text)
returns table (id uuid)
language plpgsql stable security definer set search_path = ''
as $$
declare
  needle text := btrim(coalesce(term, ''));
begin
  if not coalesce(inventory.can_view(), false) then
    raise exception 'Inventory access denied' using errcode = '42501';
  end if;
  if char_length(needle) < 2 then return; end if;
  needle := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select p.id
    from public.profiles p
    where p.full_name ilike '%' || needle || '%' escape '\'
      and inventory.is_record_actor(p.id)
    order by p.id
    limit 100;
end;
$$;
revoke all on function inventory.search_people(text) from public, anon, authenticated, service_role;
grant execute on function inventory.search_people(text) to authenticated;

-- Speeds up the "appears in Inventory records" check. Request submitters already have indexes.
create index if not exists inventory_products_created_by_idx on inventory.products (created_by) where created_by is not null;
create index if not exists inventory_products_updated_by_idx on inventory.products (updated_by) where updated_by is not null;
create index if not exists inventory_products_removed_by_idx on inventory.products (removed_by) where removed_by is not null;
create index if not exists inventory_product_requests_reviewed_by_idx on inventory.product_requests (reviewed_by) where reviewed_by is not null;
create index if not exists inventory_product_images_uploaded_by_idx on inventory.product_images (uploaded_by) where uploaded_by is not null;
create index if not exists inventory_movements_created_by_idx on inventory.movements (created_by);
create index if not exists inventory_movement_requests_reviewed_by_idx on inventory.movement_requests (reviewed_by) where reviewed_by is not null;
create index if not exists inventory_reservations_created_by_idx on inventory.reservations (created_by);
create index if not exists inventory_reservations_released_by_idx on inventory.reservations (released_by) where released_by is not null;
create index if not exists inventory_local_brands_created_by_idx on inventory.local_brands (created_by) where created_by is not null;

-- ROLLBACK (manual, intentionally commented):
-- drop function if exists inventory.search_people(text);
-- drop function if exists inventory.person_names(uuid[]);
-- drop function if exists inventory.is_record_actor(uuid);
-- drop index if exists inventory.inventory_products_created_by_idx, inventory.inventory_products_updated_by_idx, inventory.inventory_products_removed_by_idx, inventory.inventory_product_requests_reviewed_by_idx, inventory.inventory_product_images_uploaded_by_idx, inventory.inventory_movements_created_by_idx, inventory.inventory_movement_requests_reviewed_by_idx, inventory.inventory_reservations_created_by_idx, inventory.inventory_reservations_released_by_idx, inventory.inventory_local_brands_created_by_idx;
