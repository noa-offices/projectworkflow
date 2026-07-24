alter type public.user_role add value if not exists 'sales_coordinator' after 'sales_designer';

create or replace function public.current_user_is_sales_coordinator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_user_role()::text = 'sales_coordinator'
    and public.current_account_status() = 'active',
    false
  );
$$;

grant execute on function public.current_user_is_sales_coordinator() to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients',
    'projects',
    'quotations',
    'quotation_sections',
    'quotation_items',
    'brands',
    'product_categories',
    'product_templates',
    'product_components',
    'product_template_linked_families',
    'brand_material_groups',
    'brand_materials',
    'product_template_material_groups',
    'product_template_material_group_items',
    'product_template_price_history',
    'product_template_detail_price_history',
    'quotation_item_price_history',
    'audit_activity_log',
    'quotation_presentations',
    'quotation_procurement_rfqs',
    'quotation_purchase_orders',
    'quotation_order_confirmations',
    'quotation_pdfs',
    'delivery_notes'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'sc_' || table_name || '_select', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.current_user_is_sales_coordinator())',
      'sc_' || table_name || '_select',
      table_name
    );

    execute format('drop policy if exists %I on public.%I', 'sc_' || table_name || '_insert', table_name);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.current_user_is_sales_coordinator())',
      'sc_' || table_name || '_insert',
      table_name
    );

    execute format('drop policy if exists %I on public.%I', 'sc_' || table_name || '_update', table_name);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.current_user_is_sales_coordinator()) with check (public.current_user_is_sales_coordinator())',
      'sc_' || table_name || '_update',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'quotations',
    'quotation_sections',
    'quotation_items',
    'brands',
    'product_categories',
    'product_templates',
    'product_template_linked_families',
    'brand_material_groups',
    'brand_materials',
    'product_template_material_groups',
    'product_template_material_group_items'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'sc_' || table_name || '_delete', table_name);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.current_user_is_sales_coordinator())',
      'sc_' || table_name || '_delete',
      table_name
    );
  end loop;
end;
$$;

drop policy if exists sc_sales_product_images_all on storage.objects;

create policy sc_sales_product_images_all
on storage.objects
for all
to authenticated
using (
  bucket_id in ('quote-images', 'product-images')
  and public.current_user_is_sales_coordinator()
)
with check (
  bucket_id in ('quote-images', 'product-images')
  and public.current_user_is_sales_coordinator()
);
