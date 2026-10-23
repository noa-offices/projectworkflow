-- Inventory access is separate from the existing ERP tables and buckets.
revoke all on schema inventory from public, anon;
grant usage on schema inventory to authenticated, service_role;

revoke all on all tables in schema inventory from public, anon;
revoke all on all sequences in schema inventory from public, anon;
grant select, insert, update, delete on all tables in schema inventory to authenticated;
grant all on all tables in schema inventory to service_role;

revoke usage on type inventory.product_status, inventory.product_condition,
  inventory.product_source, inventory.product_request_status,
  inventory.inventory_movement_type, inventory.dimension_unit from public, anon;
grant usage on type inventory.product_status, inventory.product_condition,
  inventory.product_source, inventory.product_request_status,
  inventory.inventory_movement_type, inventory.dimension_unit to authenticated, service_role;

alter table inventory.categories enable row level security;
alter table inventory.products enable row level security;
alter table inventory.product_requests enable row level security;
alter table inventory.product_images enable row level security;
alter table inventory.movements enable row level security;
alter table inventory.movement_requests enable row level security;
alter table inventory.product_costs enable row level security;
alter table inventory.product_request_costs enable row level security;

-- Non-cost SELECT is available to all eight active roles, independently of write permissions.
drop policy if exists categories_select on inventory.categories;
create policy categories_select on inventory.categories for select to authenticated
  using (inventory.can_view());
drop policy if exists products_select on inventory.products;
create policy products_select on inventory.products for select to authenticated
  using (inventory.can_view());
drop policy if exists product_requests_select on inventory.product_requests;
create policy product_requests_select on inventory.product_requests for select to authenticated
  using (inventory.can_view());
drop policy if exists product_images_select on inventory.product_images;
create policy product_images_select on inventory.product_images for select to authenticated
  using (inventory.can_view());
drop policy if exists movements_select on inventory.movements;
create policy movements_select on inventory.movements for select to authenticated
  using (inventory.can_view());
drop policy if exists movement_requests_select on inventory.movement_requests;
create policy movement_requests_select on inventory.movement_requests for select to authenticated
  using (inventory.can_view());

-- Cost SELECT is restricted independently from the parent product/request records.
drop policy if exists product_costs_select on inventory.product_costs;
create policy product_costs_select on inventory.product_costs for select to authenticated
  using (inventory.can_manage());
drop policy if exists product_request_costs_select on inventory.product_request_costs;
create policy product_request_costs_select on inventory.product_request_costs for select to authenticated
  using (inventory.can_manage());

-- Direct writes are manager-only except for the pending-request photo INSERT below.
do $$
declare target_table text;
begin
  foreach target_table in array array['categories', 'products', 'movements', 'product_images', 'product_costs', 'product_request_costs'] loop
    execute format('drop policy if exists %I on inventory.%I', target_table || '_insert', target_table);
    execute format('create policy %I on inventory.%I for insert to authenticated with check (inventory.can_manage())', target_table || '_insert', target_table);
    execute format('drop policy if exists %I on inventory.%I', target_table || '_update', target_table);
    execute format('create policy %I on inventory.%I for update to authenticated using (inventory.can_manage()) with check (inventory.can_manage())', target_table || '_update', target_table);
    execute format('drop policy if exists %I on inventory.%I', target_table || '_delete', target_table);
    execute format('create policy %I on inventory.%I for delete to authenticated using (inventory.can_manage())', target_table || '_delete', target_table);
  end loop;
end $$;

drop policy if exists product_images_insert_request_submitter on inventory.product_images;
create policy product_images_insert_request_submitter on inventory.product_images
  for insert to authenticated
  with check (
    product_request_id is not null
    and product_id is null
    and uploaded_by = auth.uid()
    and inventory.can_request_add_take()
    and exists (
      select 1 from inventory.product_requests request
      where request.id = product_images.product_request_id
        and request.submitted_by = auth.uid()
        and request.request_status = 'pending_review'
    )
  );

drop policy if exists product_requests_insert on inventory.product_requests;
create policy product_requests_insert on inventory.product_requests for insert to authenticated
  with check (
    (inventory.can_manage() or inventory.can_request_add_take())
    and submitted_by = auth.uid()
    and request_status = 'pending_review'
  );
drop policy if exists product_requests_update on inventory.product_requests;
create policy product_requests_update on inventory.product_requests for update to authenticated
  using (inventory.can_manage()) with check (inventory.can_manage());
drop policy if exists product_requests_delete on inventory.product_requests;
create policy product_requests_delete on inventory.product_requests for delete to authenticated
  using (inventory.can_manage());

drop policy if exists movement_requests_insert on inventory.movement_requests;
create policy movement_requests_insert on inventory.movement_requests for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and request_status = 'pending_review'
    and (
      inventory.can_manage()
      or (inventory.can_request_hold_book() and request_type in ('hold', 'book'))
      or (inventory.can_request_add_take() and request_type in ('take', 'move'))
    )
  );
drop policy if exists movement_requests_update on inventory.movement_requests;
create policy movement_requests_update on inventory.movement_requests for update to authenticated
  using (inventory.can_manage()) with check (inventory.can_manage());
-- No DELETE policy for movement requests: the supported write operation is review.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventory-images', 'inventory-images', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists inventory_images_select on storage.objects;
create policy inventory_images_select on storage.objects for select to authenticated
  using (bucket_id = 'inventory-images' and inventory.can_view());

-- Object names have exactly two folders and a file: products/<uuid>/<file>
-- or requests/<uuid>/<file>. Only the requests/ path is open to request submitters.
drop policy if exists inventory_images_insert on storage.objects;
create policy inventory_images_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'inventory-images'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] in ('products', 'requests')
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and length(storage.filename(name)) > 0
    and (
      inventory.can_manage()
      or (
        (storage.foldername(name))[1] = 'requests'
        and (inventory.can_request_hold_book() or inventory.can_request_add_take())
      )
    )
  );

drop policy if exists inventory_images_update on storage.objects;
create policy inventory_images_update on storage.objects for update to authenticated
  using (bucket_id = 'inventory-images' and inventory.can_manage())
  with check (
    bucket_id = 'inventory-images' and inventory.can_manage()
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] in ('products', 'requests')
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and length(storage.filename(name)) > 0
  );

drop policy if exists inventory_images_delete on storage.objects;
create policy inventory_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'inventory-images' and inventory.can_manage());

-- ROLLBACK (manual; removes only this migration's policies and access grants).
-- BEGIN;
-- drop policy if exists inventory_images_select on storage.objects;
-- drop policy if exists inventory_images_insert on storage.objects;
-- drop policy if exists inventory_images_update on storage.objects;
-- drop policy if exists inventory_images_delete on storage.objects;
-- drop policy if exists product_images_insert_request_submitter on inventory.product_images;
-- do $$
-- declare target_table text; operation text;
-- begin
--   foreach target_table in array array['categories', 'products', 'movements', 'product_images', 'product_requests', 'movement_requests', 'product_costs', 'product_request_costs'] loop
--     foreach operation in array array['select', 'insert', 'update', 'delete'] loop
--       execute format('drop policy if exists %I on inventory.%I', target_table || '_' || operation, target_table);
--     end loop;
--   end loop;
-- end $$;
-- revoke all on all tables in schema inventory from authenticated, service_role;
-- revoke usage on type inventory.product_status, inventory.product_condition,
--   inventory.product_source, inventory.product_request_status,
--   inventory.inventory_movement_type, inventory.dimension_unit from authenticated, service_role;
-- revoke usage on schema inventory from authenticated, service_role;
-- Bucket retained intentionally; empty/remove it through the Storage API if needed.
-- RLS remains enabled and there are no inventory table policies granting access.
-- COMMIT;
