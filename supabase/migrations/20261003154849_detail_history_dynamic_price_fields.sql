-- Retain scalar locators and allow persisted matrix column IDs, not only Cat A-D.
alter table public.product_template_detail_price_history
  drop constraint product_template_detail_price_history_price_field_check,
  add constraint product_template_detail_price_history_price_field_check check (
    price_field in ('unit_price', 'default_price', 'additional_price', 'price')
    or (left(price_field, 7) = 'prices.' and length(price_field) > 7)
  );
