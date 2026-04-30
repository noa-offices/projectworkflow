"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSystemOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AccountStatus, AppRole } from "@/lib/supabase/types";

const allowedRoles = [
  "system_owner",
  "admin_manager",
  "sales_designer",
  "viewer",
] satisfies AppRole[];

const allowedStatuses = [
  "pending",
  "active",
  "disabled",
] satisfies AccountStatus[];

function isAppRole(value: string): value is AppRole {
  return allowedRoles.includes(value as AppRole);
}

function isAccountStatus(value: string): value is AccountStatus {
  return allowedStatuses.includes(value as AccountStatus);
}

function formValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function redirectWithMessage(message: string): never {
  redirect(`/settings/users?message=${encodeURIComponent(message)}`);
}

export async function updateUserRole(profileId: string, formData: FormData) {
  const { user } = await requireSystemOwner();
  const role = formValue(formData, "role");

  if (!isAppRole(role)) {
    redirectWithMessage("That role is not allowed.");
  }

  if (profileId === user.id && role !== "system_owner") {
    redirectWithMessage("You cannot remove your own System Owner role.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", profileId);

  if (error) {
    console.error("USER ROLE UPDATE ERROR", error.message);
    redirectWithMessage("Role update failed.");
  }

  revalidatePath("/settings/users");
  redirectWithMessage("Role updated.");
}

export async function updateUserStatus(profileId: string, formData: FormData) {
  const { user } = await requireSystemOwner();
  const accountStatus = formValue(formData, "account_status");

  if (!isAccountStatus(accountStatus)) {
    redirectWithMessage("That account status is not allowed.");
  }

  if (profileId === user.id && accountStatus === "disabled") {
    redirectWithMessage("You cannot disable your own account.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ account_status: accountStatus })
    .eq("id", profileId);

  if (error) {
    console.error("USER STATUS UPDATE ERROR", error.message);
    redirectWithMessage("Status update failed.");
  }

  revalidatePath("/settings/users");
  redirectWithMessage("Status updated.");
}
