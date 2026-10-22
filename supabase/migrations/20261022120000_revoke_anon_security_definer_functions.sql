-- Remove "not logged in" (anon) access from SECURITY DEFINER functions.
-- Logged-in users (authenticated) and the server (service_role) keep access.
-- Already applied on the live database on 2026-10-22. Safe to run again.

do $$
declare f text;
begin
  -- Helper / RPC functions
  foreach f in array array[
    'public.current_account_status()',
    'public.current_user_can_access_procurement()',
    'public.current_user_can_manage_client_payment_installments()',
    'public.current_user_can_manage_company_settings()',
    'public.current_user_can_manage_records()',
    'public.current_user_can_manage_settings()',
    'public.current_user_can_record_client_payment_receipts()',
    'public.current_user_can_view_client_payments()',
    'public.current_user_can_void_client_payment_receipts()',
    'public.current_user_is_active()',
    'public.current_user_is_sales_coordinator()',
    'public.current_user_role()',
    'public.list_commission_sales_managers()',
    'public.replace_sales_commission_rule_version(uuid,text,text,numeric,numeric,text,jsonb,text,timestamp with time zone,timestamp with time zone,text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;

  -- Trigger / event-trigger functions (never called directly; triggers still fire)
  foreach f in array array[
    'public.assign_client_number()',
    'public.assign_project_number()',
    'public.assign_quotation_document_number()',
    'public.handle_new_user_profile()',
    'public.prevent_self_profile_privileged_field_changes()',
    'public.profiles_self_service_update()',
    'public.rls_auto_enable()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;
