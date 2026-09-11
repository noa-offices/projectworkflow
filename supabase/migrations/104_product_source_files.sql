insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-source-files', 'product-source-files', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy product_source_files_select_active_users on storage.objects for select to authenticated using (bucket_id = 'product-source-files' and public.current_user_is_active());
create policy product_source_files_insert_record_managers on storage.objects for insert to authenticated with check (bucket_id = 'product-source-files' and public.current_user_can_manage_records());
