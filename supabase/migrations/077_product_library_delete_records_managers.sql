-- Extend product library DELETE access from settings-tier
-- (system_owner, admin_manager, designer) to records-tier
-- (system_owner, admin_manager, procurement_manager, sales_designer,
-- designer) on: brands, product_categories, product_templates,
-- product_template_linked_families.
--
-- product_components has no DELETE policy and none is added here.

drop policy if exists brands_delete_settings_managers on public.brands;

create policy brands_delete_settings_managers
on public.brands
for delete
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists product_categories_delete_settings_managers on public.product_categories;

create policy product_categories_delete_settings_managers
on public.product_categories
for delete
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists product_templates_delete_settings_managers on public.product_templates;

create policy product_templates_delete_settings_managers
on public.product_templates
for delete
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists product_template_linked_families_delete_settings_managers
on public.product_template_linked_families;

create policy product_template_linked_families_delete_settings_managers
on public.product_template_linked_families
for delete
to authenticated
using (public.current_user_can_manage_records());
