-- My Collection custom item pictures (PR 2b-3): a PRIVATE bucket, owner-only. NOT applied automatically.
-- Path convention: {owner_id}/{item_id}/{timestamp}-{name}. The first folder must equal the caller's user id.
-- Why a new bucket: quote-images lets every active user read and only records managers write, which is wrong for
-- private My Collection pictures. saved_custom_items.image_path already enforces the {owner_id}/ prefix.
-- Pattern copied from 016_storage_quote_images.sql (private bucket, 5 MB, png/jpeg/webp, policies on storage.objects).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('my-collection-images', 'my-collection-images', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists my_collection_images_select_own on storage.objects;
create policy my_collection_images_select_own
on storage.objects for select to authenticated
using (
  bucket_id = 'my-collection-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.current_user_is_active())
);

drop policy if exists my_collection_images_insert_own on storage.objects;
create policy my_collection_images_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'my-collection-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.current_user_is_active())
);

drop policy if exists my_collection_images_update_own on storage.objects;
create policy my_collection_images_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'my-collection-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.current_user_is_active())
)
with check (
  bucket_id = 'my-collection-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists my_collection_images_delete_own on storage.objects;
create policy my_collection_images_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'my-collection-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
