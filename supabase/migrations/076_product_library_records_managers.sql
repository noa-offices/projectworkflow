-- Extend product library write access (insert/update) and the managers'
-- select policy from settings-tier (system_owner, admin_manager, designer)
-- to records-tier (system_owner, admin_manager, procurement_manager,
-- sales_designer, designer) on: brands, product_categories,
-- product_templates, product_components, product_template_linked_families.
--
-- DELETE policies on these tables are intentionally left unchanged
-- (stay current_user_can_manage_settings() — top 2 roles only).
-- product_components has no DELETE policy and none is added here.

-- brands

drop policy if exists brands_select_managers on public.brands;

create policy brands_select_managers
on public.brands
for select
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists brands_insert_managers on public.brands;

create policy brands_insert_managers
on public.brands
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists brands_update_managers on public.brands;

create policy brands_update_managers
on public.brands
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

-- product_categories

drop policy if exists product_categories_select_managers on public.product_categories;

create policy product_categories_select_managers
on public.product_categories
for select
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists product_categories_insert_managers on public.product_categories;

create policy product_categories_insert_managers
on public.product_categories
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists product_categories_update_managers on public.product_categories;

create policy product_categories_update_managers
on public.product_categories
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

-- product_templates

drop policy if exists product_templates_select_managers on public.product_templates;

create policy product_templates_select_managers
on public.product_templates
for select
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists product_templates_insert_managers on public.product_templates;

create policy product_templates_insert_managers
on public.product_templates
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists product_templates_update_managers on public.product_templates;

create policy product_templates_update_managers
on public.product_templates
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

-- product_components

drop policy if exists product_components_select_managers on public.product_components;

create policy product_components_select_managers
on public.product_components
for select
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists product_components_insert_managers on public.product_components;

create policy product_components_insert_managers
on public.product_components
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists product_components_update_managers on public.product_components;

create policy product_components_update_managers
on public.product_components
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

-- product_template_linked_families

drop policy if exists product_template_linked_families_select_managers on public.product_template_linked_families;

create policy product_template_linked_families_select_managers
on public.product_template_linked_families
for select
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists product_template_linked_families_insert_managers on public.product_template_linked_families;

create policy product_template_linked_families_insert_managers
on public.product_template_linked_families
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists product_template_linked_families_update_managers on public.product_template_linked_families;

create policy product_template_linked_families_update_managers
on public.product_template_linked_families
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());
