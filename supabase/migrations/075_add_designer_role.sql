-- Add designer to the enum
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'designer' AFTER 'sales_designer';

-- Update current_user_can_manage_settings() to include designer
-- (designer can now write to brands, product_categories, product_templates, product_components)
CREATE OR REPLACE FUNCTION public.current_user_can_manage_settings()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    public.current_user_role() in ('system_owner', 'admin_manager', 'designer')
    and public.current_account_status() = 'active',
    false
  );
$$;

-- Update current_user_can_manage_records() to include designer
CREATE OR REPLACE FUNCTION public.current_user_can_manage_records()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role IN ('system_owner', 'admin_manager', 'procurement_manager', 'sales_designer', 'designer')
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

-- current_user_can_access_procurement() is intentionally NOT modified —
-- designer must not gain procurement access.
