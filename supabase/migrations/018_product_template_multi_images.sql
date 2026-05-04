alter table public.product_templates
add column if not exists proposed_image_url_1 text,
add column if not exists proposed_image_url_2 text,
add column if not exists proposed_image_url_3 text;

update public.product_templates
set proposed_image_url_1 = coalesce(proposed_image_url_1, default_image_url)
where proposed_image_url_1 is null
  and default_image_url is not null;

update public.product_templates
set image_settings = jsonb_set(
  image_settings,
  '{proposed_image_url_1}',
  image_settings->'default_image_url',
  true
)
where image_settings ? 'default_image_url'
  and not image_settings ? 'proposed_image_url_1';
