-- Add salesperson attribution to quotations
alter table public.quotations
  add column if not exists salesperson_id uuid references public.profiles(id);

-- Add avatar URL to profiles
alter table public.profiles
  add column if not exists avatar_url text;

-- Create avatars storage bucket (private, 2 MB, images only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies for avatars bucket
drop policy if exists avatars_select_active on storage.objects;
create policy avatars_select_active
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and public.current_user_is_active()
);

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.current_user_is_active()
);

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.current_user_is_active()
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.current_user_is_active()
);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.current_user_is_active()
);
