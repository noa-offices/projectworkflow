import type { AccountStatus, AppRole } from "@/lib/supabase/types";

export const USER_ROLE_OPTIONS = [
  "system_owner",
  "admin_manager",
  "procurement_manager",
  "sales_designer",
  "sales_coordinator",
  "designer",
  "viewer",
] satisfies AppRole[];

export const USER_STATUS_OPTIONS = [
  "pending",
  "active",
  "disabled",
] satisfies AccountStatus[];

export function userRoleLabel(role: AppRole | null | undefined) {
  switch (role) {
    case "system_owner":
      return "System Owner";
    case "admin_manager":
      return "Admin Manager";
    case "procurement_manager":
      return "Procurement Manager";
    case "sales_designer":
      return "Sales Manager";
    case "sales_coordinator":
      return "Sales Coordinator";
    case "designer":
      return "Designer";
    case "viewer":
      return "Viewer";
    default:
      return "Unknown role";
  }
}

export function userStatusLabel(status: AccountStatus | null | undefined) {
  switch (status) {
    case "active":
      return "Active";
    case "pending":
      return "Pending";
    case "disabled":
      return "Suspended";
    default:
      return "Unknown status";
  }
}

export function userStatusBadgeClass(status: AccountStatus | null | undefined) {
  switch (status) {
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "disabled":
      return "border-red-200 bg-red-50 text-red-800";
    default:
      return "border-zinc-200 bg-zinc-100 text-zinc-600";
  }
}
