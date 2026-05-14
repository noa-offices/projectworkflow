alter table public.product_templates
add column if not exists proposed_image_url_4 text,
add column if not exists proposed_image_url_5 text,
add column if not exists proposed_image_url_6 text,
add column if not exists proposed_image_url_7 text,
add column if not exists proposed_image_url_8 text,
add column if not exists proposed_image_url_9 text,
add column if not exists proposed_image_url_10 text,
add column if not exists proposed_image_url_11 text,
add column if not exists proposed_image_url_12 text,
add column if not exists proposed_image_url_13 text,
add column if not exists proposed_image_url_14 text,
add column if not exists proposed_image_url_15 text,
add column if not exists proposed_image_url_16 text,
add column if not exists proposed_image_url_17 text,
add column if not exists proposed_image_url_18 text,
add column if not exists proposed_image_url_19 text,
add column if not exists proposed_image_url_20 text;

update public.product_templates
set proposed_image_url_4 = coalesce(proposed_image_url_4, image_settings->>'proposed_image_url_4_path'),
    proposed_image_url_5 = coalesce(proposed_image_url_5, image_settings->>'proposed_image_url_5_path'),
    proposed_image_url_6 = coalesce(proposed_image_url_6, image_settings->>'proposed_image_url_6_path'),
    proposed_image_url_7 = coalesce(proposed_image_url_7, image_settings->>'proposed_image_url_7_path'),
    proposed_image_url_8 = coalesce(proposed_image_url_8, image_settings->>'proposed_image_url_8_path')
where image_settings is not null
  and (
    image_settings ? 'proposed_image_url_4_path'
    or image_settings ? 'proposed_image_url_5_path'
    or image_settings ? 'proposed_image_url_6_path'
    or image_settings ? 'proposed_image_url_7_path'
    or image_settings ? 'proposed_image_url_8_path'
  );
