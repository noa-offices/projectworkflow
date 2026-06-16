-- Add procurement_manager to the enum
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'procurement_manager' AFTER 'admin_manager';

-- Update current_user_can_manage_records() to include procurement_manager
CREATE OR REPLACE FUNCTION public.current_user_can_manage_records()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role IN ('system_owner', 'admin_manager', 'procurement_manager', 'sales_designer')
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

-- New helper: procurement access only (procurement_manager and above)
CREATE OR REPLACE FUNCTION public.current_user_can_access_procurement()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role IN ('system_owner', 'admin_manager', 'procurement_manager')
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_can_access_procurement() TO authenticated;
