drop policy if exists clients_delete_record_managers on public.clients;

create policy clients_delete_record_managers
on public.clients
for delete
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists projects_delete_record_managers on public.projects;

create policy projects_delete_record_managers
on public.projects
for delete
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists quotations_delete_record_managers on public.quotations;

create policy quotations_delete_record_managers
on public.quotations
for delete
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists quotation_sections_delete_record_managers on public.quotation_sections;

create policy quotation_sections_delete_record_managers
on public.quotation_sections
for delete
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists quotation_sections_select_record_managers on public.quotation_sections;

create policy quotation_sections_select_record_managers
on public.quotation_sections
for select
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists quotation_items_delete_record_managers on public.quotation_items;

create policy quotation_items_delete_record_managers
on public.quotation_items
for delete
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists quotation_items_select_record_managers on public.quotation_items;

create policy quotation_items_select_record_managers
on public.quotation_items
for select
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists brands_delete_settings_managers on public.brands;

create policy brands_delete_settings_managers
on public.brands
for delete
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists product_categories_delete_settings_managers on public.product_categories;

create policy product_categories_delete_settings_managers
on public.product_categories
for delete
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists product_templates_delete_settings_managers on public.product_templates;

create policy product_templates_delete_settings_managers
on public.product_templates
for delete
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists product_template_linked_families_delete_settings_managers
on public.product_template_linked_families;

create policy product_template_linked_families_delete_settings_managers
on public.product_template_linked_families
for delete
to authenticated
using (public.current_user_can_manage_settings());

grant delete on public.clients to authenticated;
grant delete on public.projects to authenticated;
grant delete on public.quotations to authenticated;
grant delete on public.quotation_sections to authenticated;
grant delete on public.quotation_items to authenticated;
grant delete on public.brands to authenticated;
grant delete on public.product_categories to authenticated;
grant delete on public.product_templates to authenticated;
grant delete on public.product_template_linked_families to authenticated;
