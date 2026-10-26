import { userRoleLabel } from "@/lib/user-management";
import type { AppRole } from "@/lib/supabase/types";
import { inventoryPersonName } from "./presentation";

export const INVENTORY_PROFILE_PATH = "/inventory/profile";
export const INVENTORY_NOTIFICATIONS_PATH = "/inventory/notifications";
// Same minimum as the existing reset-password flow (app/auth/actions.ts updatePassword).
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_NAME_LENGTH = 100;
export const MAX_PHONE_LENGTH = 30;

export type ProfileInput = { fullName: string; phone: string };
export type ProfileFieldErrors = Partial<Record<"fullName" | "phone", string>>;
export type PasswordFieldErrors = Partial<Record<"password" | "confirmPassword", string>>;

/** Only the two fields a person may edit. Role, status and permissions never pass through here. */
export function validateProfileInput(input: { fullName?: unknown; phone?: unknown }): { ok: true; value: { fullName: string; phone: string | null } } | { ok: false; errors: ProfileFieldErrors } {
  const fullName = typeof input.fullName === "string" ? input.fullName.trim().replace(/\s+/g, " ") : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const errors: ProfileFieldErrors = {};
  if (!fullName) errors.fullName = "Enter your full name.";
  else if (fullName.length > MAX_NAME_LENGTH) errors.fullName = `Your name must be ${MAX_NAME_LENGTH} letters or fewer.`;
  else if (fullName.includes("@")) errors.fullName = "Enter your name, not an email address.";
  if (phone) {
    const digits = phone.replace(/\D/g, "").length;
    if (phone.length > MAX_PHONE_LENGTH || !/^\+?[0-9\s().-]+$/.test(phone) || digits < 6 || digits > 15) errors.phone = "Enter a valid phone number, for example +971 50 123 4567.";
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { fullName, phone: phone || null } };
}

export function validatePasswordChange(input: { password?: unknown; confirmPassword?: unknown }): { ok: true } | { ok: false; errors: PasswordFieldErrors } {
  const password = typeof input.password === "string" ? input.password : "";
  const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";
  const errors: PasswordFieldErrors = {};
  if (!password) errors.password = "Enter a new password.";
  else if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!confirmPassword) errors.confirmPassword = "Type the new password again.";
  else if (password && confirmPassword !== password) errors.confirmPassword = "The two passwords do not match.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}

/** Task 12 rule: full name only, never an email address; "Team member" when there is none. */
export const profileDisplayName = (fullName: string | null | undefined): string => inventoryPersonName(fullName);
export const profileRoleLabel = (role: AppRole | null | undefined): string => (role ? userRoleLabel(role) : "Team member");

/** Inside Inventory the profile and notification links stay inside Inventory, so the access lock never redirects. */
export const isInventoryPath = (pathname: string | null | undefined): boolean => pathname === "/inventory" || (pathname ?? "").startsWith("/inventory/");
export const profileHref = (pathname: string | null | undefined): string => isInventoryPath(pathname) ? INVENTORY_PROFILE_PATH : "/settings/profile";
export const notificationsHref = (pathname: string | null | undefined): string => isInventoryPath(pathname) ? INVENTORY_NOTIFICATIONS_PATH : "/notifications";
/** Warehouse Staff have no full PW profile; every other role gets the link. */
export const showFullProfileLink = (role: AppRole | null | undefined): boolean => role !== "warehouse_staff";
