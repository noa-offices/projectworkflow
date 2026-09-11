drop policy if exists product_source_files_select_active_users on storage.objects;
create policy product_source_files_select_product_library_roles
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-source-files'
  and public.current_user_is_active()
  and public.current_user_role()::text in (
    'system_owner',
    'admin_manager',
    'procurement_manager',
    'sales_designer',
    'sales_coordinator',
    'designer'
  )
);

drop policy if exists product_source_files_insert_record_managers on storage.objects;
create policy product_source_files_insert_product_library_roles
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-source-files'
  and public.current_user_is_active()
  and public.current_user_role()::text in (
    'system_owner',
    'admin_manager',
    'procurement_manager',
    'sales_designer',
    'sales_coordinator',
    'designer'
  )
);

drop policy if exists product_source_files_delete_product_library_roles on storage.objects;
create policy product_source_files_delete_product_library_roles
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-source-files'
  and public.current_user_is_active()
  and public.current_user_role()::text in (
    'system_owner',
    'admin_manager',
    'procurement_manager',
    'sales_designer',
    'sales_coordinator',
    'designer'
  )
);
