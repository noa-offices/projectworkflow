"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { createAuditLog } from "@/lib/audit-log";
import { requireSystemOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AccountStatus, AppRole } from "@/lib/supabase/types";
import { USER_ROLE_OPTIONS, USER_STATUS_OPTIONS } from "@/lib/user-management";

const allowedRoles = USER_ROLE_OPTIONS satisfies AppRole[];
const allowedStatuses = USER_STATUS_OPTIONS satisfies AccountStatus[];

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

function actionErrorMessage(actionLabel: string, error: unknown, fallbackMessage?: string) {
  return formatSafeActionError(actionLabel, error, fallbackMessage);
}

export async function updateUserAccess(profileId: string, formData: FormData) {
  const { user, displayName } = await requireSystemOwner();
  const role = formValue(formData, "role");
  const accountStatus = formValue(formData, "account_status");

  if (!isAppRole(role)) {
    redirectWithMessage("That role is not allowed.");
  }

  if (!isAccountStatus(accountStatus)) {
    redirectWithMessage("That account status is not allowed.");
  }

  if (profileId === user.id) {
    if (role !== "system_owner") {
      redirectWithMessage("You cannot remove your own System Owner role.");
    }

    if (accountStatus !== "active") {
      redirectWithMessage("You cannot change your own account away from Active.");
    }
  }

  const supabase = await createClient();
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("role,account_status,email,full_name")
    .eq("id", profileId)
    .maybeSingle<{
      role: AppRole;
      account_status: AccountStatus;
      email: string | null;
      full_name: string | null;
    }>();

  if (!existingProfile) {
    redirectWithMessage("User record not found.");
  }

  if (
    existingProfile.role === role
    && existingProfile.account_status === accountStatus
  ) {
    redirectWithMessage("No changes to save.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ role, account_status: accountStatus })
    .eq("id", profileId);

  if (error) {
    logServerActionError("USER ACCESS UPDATE ERROR", error, {
      action: "updateUserAccess",
      recordId: profileId,
      table: "profiles",
    });
    redirectWithMessage(actionErrorMessage("User access update failed", error));
  }

  await createAuditLog(supabase, {
    entityType: "profile",
    entityId: profileId,
    action: "user_access_updated",
    title: "User access updated",
    description: existingProfile.full_name?.trim() || existingProfile.email?.trim() || "User access updated.",
    metadata: {
      nextAccountStatus: accountStatus,
      nextRole: role,
      previousAccountStatus: existingProfile.account_status,
      previousRole: existingProfile.role,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/settings/users");
  redirectWithMessage("User access updated.");
}
