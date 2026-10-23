import type { AccountStatus, AppRole } from "./supabase/types";

type AccessProfile = { role: AppRole | null; account_status: AccountStatus | null };

export function activeUserRedirect(profile: AccessProfile | null, inventoryAllowed = false): string | null {
  if (profile?.account_status === "disabled") {
    return "/login?message=Your%20account%20has%20been%20disabled.";
  }
  if (profile?.account_status !== "active") return "/pending-approval";
  if (profile.role === "warehouse_staff" && !inventoryAllowed) return "/inventory";
  return null;
}
