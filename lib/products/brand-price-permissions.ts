import type { AccountStatus, AppRole } from "../supabase/types";

// Supplier / Brand price review is editable by these roles only. Any other role (sales_designer, viewer, ...) is read-only.
// Keep in sync with current_user_can_review_brand_prices() / current_user_can_approve_brand_prices() in the database.
const brandPriceEditorRoles: ReadonlySet<string> = new Set<AppRole>(["system_owner", "admin_manager", "procurement_manager", "sales_coordinator", "designer"]);

export function canReviewBrandPrices(role: AppRole | null | undefined, accountStatus: AccountStatus | null | undefined): boolean {
  return accountStatus === "active" && role != null && brandPriceEditorRoles.has(role);
}

export function canApproveBrandPrices(role: AppRole | null | undefined, accountStatus: AccountStatus | null | undefined): boolean {
  return canReviewBrandPrices(role, accountStatus);
}
