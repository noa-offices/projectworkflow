alter table public.product_templates
add column if not exists origin text,
add column if not exists supplier_name text;
