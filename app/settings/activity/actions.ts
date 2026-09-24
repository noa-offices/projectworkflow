"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validateActivityTrackingSettings } from "@/lib/activity-time/activity-settings-validation";
import { requireSystemOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function formValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function redirectToActivitySettings(message: string, messageType: "error" | "success"): never {
  const query = new URLSearchParams({ message, messageType });
  redirect(`/settings/activity?${query.toString()}`);
}

export async function saveActivityTrackingSettings(formData: FormData) {
  await requireSystemOwner();
  const validation = validateActivityTrackingSettings(
    formValue(formData, "organization_timezone"),
    formValue(formData, "activity_idle_timeout_minutes"),
  );
  if (!validation.ok) redirectToActivitySettings(validation.message, "error");

  const supabase = await createClient();
  const { error } = await supabase
    .from("projectworkflow_activity_settings")
    .update({
      activity_idle_timeout_minutes: validation.value.idleTimeoutMinutes,
      organization_timezone: validation.value.organizationTimeZone,
    })
    .eq("id", 1);
  if (error) redirectToActivitySettings("Activity tracking settings could not be saved.", "error");

  revalidatePath("/settings/activity");
  redirectToActivitySettings("Activity tracking settings updated.", "success");
}
