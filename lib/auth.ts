import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { AccountStatus, AppRole } from "@/lib/supabase/types";
import { isClientPaymentAttachmentManager } from "@/lib/projects/client-payment-attachment-permissions";
import { canReviewBrandPrices } from "@/lib/products/brand-price-permissions";
import { activeUserRedirect } from "@/lib/auth-access";

export type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone?: string | null;
  job_title?: string | null;
  department?: string | null;
  role: AppRole | null;
  account_status: AccountStatus | null;
  avatar_url?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AuthenticatedUser = {
  user: User;
  profile: UserProfile | null;
  displayName: string;
};

// Per-request memoisation (React cache): one render/request does each lookup once, nothing is shared across requests.
export const getRequestUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getProfileForUser = cache(async function getProfileForUser(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,phone,job_title,department,role,account_status,avatar_url")
    .eq("id", userId)
    .single<UserProfile>();

  if (error) {
    console.error("AUTH PROFILE ERROR", error.message);
    return null;
  }

  return data;
});

export async function isWarehouseStaffRequest(): Promise<boolean> {
  const user = await getRequestUser();
  if (!user) return false;
  try {
    const profile = await getProfileForUser(user.id);
    return !profile || profile.role === "warehouse_staff";
  } catch {
    return true;
  }
}

export async function redirectWarehouseStaff(): Promise<void> {
  if (await isWarehouseStaffRequest()) redirect("/inventory");
}

export async function requireActiveUser(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireInventoryUser();
  const destination = activeUserRedirect(authenticatedUser.profile);
  if (destination) redirect(destination);
  return authenticatedUser;
}

export async function requireInventoryUser(): Promise<AuthenticatedUser> {
  const user = await getRequestUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await getProfileForUser(user.id);

  if (profile?.account_status === "disabled") {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }

  const destination = activeUserRedirect(profile, true);
  if (destination) redirect(destination);

  return {
    user,
    profile,
    displayName:
      profile?.full_name ?? user.user_metadata.full_name ?? user.email ?? "User",
  };
}

export async function requireSystemOwner(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();

  if (authenticatedUser.profile?.role !== "system_owner") {
    redirect("/dashboard");
  }

  return authenticatedUser;
}

export async function requireBrandPriceReviewer(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();
  if (!canReviewBrandPrices(authenticatedUser.profile?.role, authenticatedUser.profile?.account_status)) {
    redirect("/products/templates");
  }
  return authenticatedUser;
}

export function canViewCommissions(role: AppRole | null | undefined): boolean {
  return role === "system_owner" || role === "admin_manager" || role === "sales_designer";
}

export function canManageCommissions(role: AppRole | null | undefined): boolean {
  return role === "system_owner";
}

export function canEditCommissions(role: AppRole | null | undefined): boolean {
  return role === "system_owner" || role === "admin_manager";
}

export function canViewClientPayments(role: AppRole | null | undefined): boolean {
  return role === "system_owner" || role === "admin_manager";
}

export function canManageClientPaymentInstallments(role: AppRole | null | undefined): boolean {
  return canViewClientPayments(role);
}

export function canRecordClientPaymentReceipts(role: AppRole | null | undefined): boolean {
  return canViewClientPayments(role);
}

export function canManageClientPaymentReceiptAttachments(role: AppRole | null | undefined): boolean {
  return isClientPaymentAttachmentManager(role);
}

export function canVoidClientPaymentReceipts(role: AppRole | null | undefined): boolean {
  return role === "system_owner";
}

export async function requireCommissionViewer(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();

  if (!canViewCommissions(authenticatedUser.profile?.role)) {
    redirect("/dashboard");
  }

  return authenticatedUser;
}

export async function requireCommissionManager(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();

  if (!canManageCommissions(authenticatedUser.profile?.role)) {
    redirect("/commissions");
  }

  return authenticatedUser;
}

export async function requireCommissionEditor(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();

  if (!canEditCommissions(authenticatedUser.profile?.role)) {
    redirect("/commissions");
  }

  return authenticatedUser;
}

export async function requireSettingsManager(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();
  const role = authenticatedUser.profile?.role;

  if (role !== "system_owner" && role !== "admin_manager") {
    redirect("/dashboard");
  }

  return authenticatedUser;
}

export async function requireProcurementManager(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();
  const role = authenticatedUser.profile?.role;

  if (
    role !== "system_owner" &&
    role !== "admin_manager" &&
    role !== "procurement_manager"
  ) {
    redirect("/dashboard");
  }

  return authenticatedUser;
}

export function canAccessProcurement(role: AppRole | null | undefined): boolean {
  return role === "system_owner" || role === "admin_manager" || role === "procurement_manager";
}

export function canSendNotifications(role: AppRole | null | undefined): boolean {
  return (
    role === "system_owner" ||
    role === "admin_manager" ||
    role === "procurement_manager" ||
    role === "sales_designer" ||
    role === "sales_coordinator" ||
    role === "designer"
  );
}

export function canManageProductLibrary(role: AppRole | null | undefined): boolean {
  return (
    role === "system_owner" ||
    role === "admin_manager" ||
    role === "procurement_manager" ||
    role === "sales_designer" ||
    role === "sales_coordinator" ||
    role === "designer"
  );
}

export async function requireRecordsManager(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();
  const role = authenticatedUser.profile?.role;

  if (
    role !== "system_owner" &&
    role !== "admin_manager" &&
    role !== "sales_designer" &&
    role !== "sales_coordinator" &&
    role !== "designer"
  ) {
    redirect("/dashboard");
  }

  return authenticatedUser;
}

export async function requireQuotationActionUser(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();
  const role = authenticatedUser.profile?.role;

  if (
    role !== "system_owner" &&
    role !== "admin_manager" &&
    role !== "procurement_manager" &&
    role !== "sales_designer" &&
    role !== "sales_coordinator" &&
    role !== "designer"
  ) {
    redirect("/dashboard");
  }

  return authenticatedUser;
}

export async function requireQuotationManager(): Promise<AuthenticatedUser> {
  return requireQuotationActionUser();
}

export async function requireProductPricingManager(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();
  const role = authenticatedUser.profile?.role;

  if (
    role !== "system_owner" &&
    role !== "admin_manager" &&
    role !== "procurement_manager" &&
    role !== "designer"
  ) {
    redirect("/dashboard");
  }

  return authenticatedUser;
}

export async function requireProductLibraryManager(): Promise<AuthenticatedUser> {
  const authenticatedUser = await requireActiveUser();
  if (!canManageProductLibrary(authenticatedUser.profile?.role)) {
    redirect("/dashboard");
  }

  return authenticatedUser;
}
