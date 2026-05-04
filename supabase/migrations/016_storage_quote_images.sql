insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'quote-images',
    'quote-images',
    false,
    5242880,
    array['image/png', 'image/jpeg', 'image/webp']
  ),
  (
    'product-images',
    'product-images',
    false,
    5242880,
    array['image/png', 'image/jpeg', 'image/webp']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists quote_images_select_active_users on storage.objects;
create policy quote_images_select_active_users
on storage.objects
for select
to authenticated
using (
  bucket_id = 'quote-images'
  and public.current_user_is_active()
);

drop policy if exists quote_images_insert_record_managers on storage.objects;
create policy quote_images_insert_record_managers
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'quote-images'
  and public.current_user_can_manage_records()
);

drop policy if exists quote_images_update_record_managers on storage.objects;
create policy quote_images_update_record_managers
on storage.objects
for update
to authenticated
using (
  bucket_id = 'quote-images'
  and public.current_user_can_manage_records()
)
with check (
  bucket_id = 'quote-images'
  and public.current_user_can_manage_records()
);

drop policy if exists product_images_select_active_users on storage.objects;
create policy product_images_select_active_users
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-images'
  and public.current_user_is_active()
);

drop policy if exists product_images_insert_record_managers on storage.objects;
create policy product_images_insert_record_managers
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and public.current_user_can_manage_records()
);

drop policy if exists product_images_update_record_managers on storage.objects;
create policy product_images_update_record_managers
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and public.current_user_can_manage_records()
)
with check (
  bucket_id = 'product-images'
  and public.current_user_can_manage_records()
);
