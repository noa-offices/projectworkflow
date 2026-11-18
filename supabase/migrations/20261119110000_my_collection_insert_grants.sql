-- My Collection hardening (PR 4-1, part 2): close forged provenance on INSERT. NOT applied automatically.
-- Today both tables allow inserting ANY column, so shared_by / source_* could be forged by a user's own client.
-- After this, an ordinary user can insert only the columns the app really writes. Shares set provenance inside
-- the SECURITY DEFINER accept functions. The app's services must insert only the columns listed here.
revoke insert on public.saved_setups from authenticated;
grant insert (owner_id, template_id, brand_id, brand_name, product_name, setup_name, note, recipe, recipe_version, spec_overrides, template_pricing_version_at_save)
  on public.saved_setups to authenticated;
revoke insert on public.saved_custom_items from authenticated;
grant insert (owner_id, brand_name, item_name, item_code, specification, unit_label, selling_price, currency, price_saved_at, image_path)
  on public.saved_custom_items to authenticated;
