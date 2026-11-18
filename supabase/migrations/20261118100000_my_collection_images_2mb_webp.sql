-- My Collection pictures: smaller limit and WebP only. NOT applied automatically.
-- The app now compresses every picture to WebP before it is stored, so the bucket accepts only WebP up to 2 MB.
-- (Tightens the bucket created in 20261117150000_my_collection_images_bucket.sql. Policies are unchanged.)
update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/webp']
where id = 'my-collection-images';
