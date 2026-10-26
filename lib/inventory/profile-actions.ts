"use server";

import { revalidatePath } from "next/cache";
import { logServerActionError } from "@/lib/action-errors";
import { createAuditLog } from "@/lib/audit-log";
import { requireInventoryUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { validatePasswordChange, validateProfileInput, type PasswordFieldErrors, type ProfileFieldErrors } from "./profile";

export type ProfileActionResult = { ok: true } | { ok: false; error: string; fields?: ProfileFieldErrors };
export type PasswordActionResult = { ok: true } | { ok: false; error: string; fields?: PasswordFieldErrors };

/** Updates only the signed-in person's own name and phone. Role, status and permissions are never sent. */
export async function updateInventoryProfile(input: { fullName: string; phone: string }): Promise<ProfileActionResult> {
  const checked = validateProfileInput(input ?? {});
  if (!checked.ok) return { ok: false, error: "Check the highlighted fields.", fields: checked.errors };
  const { user, displayName } = await requireInventoryUser();
  const supabase = await createClient();
  const { fullName, phone } = checked.value;
  const { error } = await supabase.from("profiles").update({ full_name: fullName, phone } as never).eq("id", user.id);
  if (error) {
    logServerActionError("INVENTORY PROFILE UPDATE ERROR", error, { action: "updateInventoryProfile", recordId: user.id, table: "profiles" });
    return { ok: false, error: "Your details could not be saved. Please try again." };
  }
  await createAuditLog(supabase, {
    entityType: "profile", entityId: user.id, action: "profile_updated", title: "Profile updated",
    description: fullName, metadata: { fullName, phone }, actorName: displayName, createdBy: user.id,
  });
  revalidatePath("/inventory", "layout");
  return { ok: true };
}

/** Same rules as the reset-password flow. The password is never logged or returned. */
export async function changeInventoryPassword(input: { password: string; confirmPassword: string }): Promise<PasswordActionResult> {
  const checked = validatePasswordChange(input ?? {});
  if (!checked.ok) return { ok: false, error: "Check the highlighted fields.", fields: checked.errors };
  await requireInventoryUser();
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) return { ok: false, error: "Your password could not be changed. Try a different password, or sign in again and retry." };
  return { ok: true };
}
