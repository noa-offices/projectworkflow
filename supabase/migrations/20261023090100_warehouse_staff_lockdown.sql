-- Apply only after the enum migration has committed in its own transaction.
-- Existing roles retain ERP access; warehouse_staff gets only the exceptions below.
create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_account_status() = 'active'
    and public.current_user_role() in (
      'system_owner', 'admin_manager', 'procurement_manager', 'sales_designer',
      'sales_coordinator', 'designer', 'viewer'
    ),
    false
  );
$$;

-- Preserve notification ownership and active-status checks for the new role.
-- SELECT exceptions are required for the bell and for recipient UPDATE visibility.
alter policy "Recipients can select their own notifications" on public.notifications
  using (recipient_id = auth.uid() and public.current_account_status() = 'active');
alter policy "Senders can select notifications they sent" on public.notifications
  using (sender_id = auth.uid() and public.current_account_status() = 'active');
alter policy "Recipients can update their own notifications" on public.notifications
  using (recipient_id = auth.uid() and public.current_account_status() = 'active');
-- The existing WITH CHECK (recipient_id = auth.uid()) is unchanged.

alter policy avatars_select_active on storage.objects
  using (bucket_id = 'avatars' and public.current_account_status() = 'active');
alter policy avatars_insert_own on storage.objects
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.current_account_status() = 'active'
  );
alter policy avatars_update_own on storage.objects
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.current_account_status() = 'active'
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.current_account_status() = 'active'
  );
alter policy avatars_delete_own on storage.objects
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.current_account_status() = 'active'
  );

-- Close the nine direct status-only ERP SELECT policies, preserving other predicates.
alter policy brands_select_active on public.brands
  using (is_active = true and public.current_user_is_active());
alter policy product_categories_select_active on public.product_categories
  using (is_active = true and public.current_user_is_active());
alter policy company_settings_select_active on public.company_settings
  using (public.current_user_is_active());
alter policy quotation_delivery_notes_select_active on public.quotation_delivery_notes
  using (public.current_user_is_active());
alter policy quotation_order_confirmations_select_active on public.quotation_order_confirmations
  using (public.current_user_is_active());
alter policy quotation_pdfs_select_active on public.quotation_pdfs
  using (public.current_user_is_active());
alter policy quotation_presentations_select_active on public.quotation_presentations
  using (public.current_user_is_active());
alter policy quotation_procurement_rfqs_select_active on public.quotation_procurement_rfqs
  using (public.current_user_is_active());
alter policy quotation_purchase_orders_select_active on public.quotation_purchase_orders
  using (public.current_user_is_active());

alter policy "authenticated users can read AI runtime settings" on public.ai_provider_settings
  using (public.current_user_is_active());
alter policy "authenticated users can read AI agent settings" on public.ai_agent_settings
  using (public.current_user_is_active());

-- These three live-only names and bucket-only predicates were confirmed by the owner.
-- Browser uploads/signed URLs use the signed-in client; server deletes require an
-- active user and an existing role allow-list before using the service-role client.
drop policy if exists project_documents_select on storage.objects;
create policy project_documents_select on storage.objects
  for select to authenticated
  using (bucket_id = 'project-documents' and public.current_user_is_active());
drop policy if exists project_documents_insert on storage.objects;
create policy project_documents_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-documents' and public.current_user_is_active());
drop policy if exists project_documents_delete on storage.objects;
create policy project_documents_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-documents' and public.current_user_is_active());

create or replace function public.current_user_can_access_inventory()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_account_status() = 'active'
    and public.current_user_role() in (
      'system_owner', 'admin_manager', 'procurement_manager', 'sales_designer',
      'sales_coordinator', 'designer', 'viewer', 'warehouse_staff'
    ),
    false
  );
$$;

create policy brands_select_inventory on public.brands
  for select to authenticated
  using (is_active = true and public.current_user_can_access_inventory());

-- Match 20261022120000_revoke_anon_security_definer_functions.sql.
revoke execute on function public.current_user_can_access_inventory() from public, anon;
grant execute on function public.current_user_can_access_inventory() to authenticated, service_role;

-- ROLLBACK (manual, intentionally commented; restores pre-lockdown policies).
-- The enum value remains: PostgreSQL cannot safely DROP an enum value in place.
-- BEGIN;
-- drop policy if exists brands_select_inventory on public.brands;
-- drop function if exists public.current_user_can_access_inventory();
-- create or replace function public.current_user_is_active()
-- returns boolean language sql stable security definer set search_path = public
-- as $$ select coalesce(public.current_account_status() = 'active', false); $$;
-- alter policy "Recipients can select their own notifications" on public.notifications
--   using (recipient_id = auth.uid() and public.current_user_is_active());
-- alter policy "Senders can select notifications they sent" on public.notifications
--   using (sender_id = auth.uid() and public.current_user_is_active());
-- alter policy "Recipients can update their own notifications" on public.notifications
--   using (recipient_id = auth.uid() and public.current_user_is_active());
-- alter policy avatars_select_active on storage.objects
--   using (bucket_id = 'avatars' and public.current_user_is_active());
-- alter policy avatars_insert_own on storage.objects
--   with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
--     and public.current_user_is_active());
-- alter policy avatars_update_own on storage.objects
--   using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
--     and public.current_user_is_active())
--   with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
--     and public.current_user_is_active());
-- alter policy avatars_delete_own on storage.objects
--   using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
--     and public.current_user_is_active());
-- alter policy brands_select_active on public.brands
--   using (is_active = true and public.current_account_status() = 'active');
-- alter policy product_categories_select_active on public.product_categories
--   using (is_active = true and public.current_account_status() = 'active');
-- alter policy company_settings_select_active on public.company_settings
--   using (public.current_account_status() = 'active');
-- alter policy quotation_delivery_notes_select_active on public.quotation_delivery_notes
--   using (public.current_account_status() = 'active');
-- alter policy quotation_order_confirmations_select_active on public.quotation_order_confirmations
--   using (public.current_account_status() = 'active');
-- alter policy quotation_pdfs_select_active on public.quotation_pdfs
--   using (public.current_account_status() = 'active');
-- alter policy quotation_presentations_select_active on public.quotation_presentations
--   using (public.current_account_status() = 'active');
-- alter policy quotation_procurement_rfqs_select_active on public.quotation_procurement_rfqs
--   using (public.current_account_status() = 'active');
-- alter policy quotation_purchase_orders_select_active on public.quotation_purchase_orders
--   using (public.current_account_status() = 'active');
-- alter policy "authenticated users can read AI runtime settings" on public.ai_provider_settings
--   using (true);
-- alter policy "authenticated users can read AI agent settings" on public.ai_agent_settings
--   using (true);
-- drop policy if exists project_documents_select on storage.objects;
-- create policy project_documents_select on storage.objects for select to authenticated
--   using (bucket_id = 'project-documents');
-- drop policy if exists project_documents_insert on storage.objects;
-- create policy project_documents_insert on storage.objects for insert to authenticated
--   with check (bucket_id = 'project-documents');
-- drop policy if exists project_documents_delete on storage.objects;
-- create policy project_documents_delete on storage.objects for delete to authenticated
--   using (bucket_id = 'project-documents');
-- COMMIT;
