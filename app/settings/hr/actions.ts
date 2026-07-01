"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { requireSettingsManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HrRow = {
  id: string;
  profile_id: string;
  date_of_joining: string | null;
  annual_leave_days: number;
  leave_taken_this_year: number;
  emirates_id_expiry: string | null;
  passport_expiry: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  hr_notes: string | null;
  updated_by: string | null;
  updated_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalTextValue(formData: FormData, name: string) {
  const value = textValue(formData, name);
  return value || null;
}

function intValue(formData: FormData, name: string, fallback: number) {
  const value = Number.parseInt(textValue(formData, name), 10);
  return Number.isFinite(value) ? value : fallback;
}

function redirectToHr(message: string, messageType: "success" | "error" = "success"): never {
  const query = new URLSearchParams();
  query.set("message", message);
  query.set("messageType", messageType);
  redirect(`/settings/hr?${query.toString()}`);
}

function getAdminClient() {
  const result = createAdminClient();
  if (!result.client) throw new Error(result.error ?? "Admin client unavailable");
  return result.client;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function getHrDetails(profileId: string): Promise<HrRow | null> {
  const adminClient = getAdminClient();

  const { data, error } = await adminClient
    .from("profiles_hr")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle<HrRow>();

  if (error) {
    console.error("HR DETAILS READ ERROR", error.message);
    return null;
  }

  return data;
}

export async function upsertUserHrDetails(profileId: string, formData: FormData) {
  const { user } = await requireSettingsManager();
  const adminClient = getAdminClient();

  const payload = {
    profile_id: profileId,
    date_of_joining: optionalTextValue(formData, "date_of_joining"),
    annual_leave_days: intValue(formData, "annual_leave_days", 30),
    leave_taken_this_year: intValue(formData, "leave_taken_this_year", 0),
    emirates_id_expiry: optionalTextValue(formData, "emirates_id_expiry"),
    passport_expiry: optionalTextValue(formData, "passport_expiry"),
    emergency_contact_name: optionalTextValue(formData, "emergency_contact_name"),
    emergency_contact_phone: optionalTextValue(formData, "emergency_contact_phone"),
    hr_notes: optionalTextValue(formData, "hr_notes"),
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };

  const { error } = await adminClient
    .from("profiles_hr")
    .upsert(payload as never, { onConflict: "profile_id" });

  if (error) {
    logServerActionError("HR UPSERT ERROR", error, {
      action: "upsertUserHrDetails",
      recordId: profileId,
      table: "profiles_hr",
    });
    redirectToHr(
      formatSafeActionError("HR details could not be saved", error),
      "error",
    );
  }

  revalidatePath("/settings/hr");
  redirectToHr("HR details saved.");
}
