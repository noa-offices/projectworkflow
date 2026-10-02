import type { AccountStatus, AppRole } from "../supabase/types";

export function canReviewBrandPrices(role: AppRole | null | undefined, accountStatus: AccountStatus | null | undefined): boolean {
  return accountStatus === "active" && (role === "system_owner" || role === "admin_manager" || role === "procurement_manager" || role === "designer");
}

export function canApproveBrandPrices(role: AppRole | null | undefined, accountStatus: AccountStatus | null | undefined): boolean {
  return accountStatus === "active" && (role === "system_owner" || role === "admin_manager" || role === "procurement_manager");
}
