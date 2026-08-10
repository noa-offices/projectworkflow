"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { requireSettingsManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VacationEntry = {
  id: string;
  start_date: string;
  end_date: string;
  note?: string;
};

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
  vacation_dates: VacationEntry[];
  updated_by: string | null;
  updated_at: string;
};

export type WorkerHrRow = {
  id: string;
  full_name: string;
  date_of_joining: string | null;
  annual_leave_days: number;
  leave_taken_this_year: number;
  emirates_id_expiry: string | null;
  passport_expiry: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  hr_notes: string | null;
  vacation_dates: VacationEntry[];
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
  redirect(`/hr?${query.toString()}`);
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

  revalidatePath("/hr");
  redirectToHr("HR details saved.");
}

export async function upsertWorkerHrDetails(workerId: string, formData: FormData) {
  const { user } = await requireSettingsManager();
  const adminClient = getAdminClient();

  const payload = {
    date_of_joining: optionalTextValue(formData, "date_of_joining"),
    annual_leave_days: intValue(formData, "annual_leave_days", 30),
    emirates_id_expiry: optionalTextValue(formData, "emirates_id_expiry"),
    passport_expiry: optionalTextValue(formData, "passport_expiry"),
    emergency_contact_name: optionalTextValue(formData, "emergency_contact_name"),
    emergency_contact_phone: optionalTextValue(formData, "emergency_contact_phone"),
    hr_notes: optionalTextValue(formData, "hr_notes"),
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };

  const { error } = await adminClient
    .from("workers")
    .update(payload as never)
    .eq("id", workerId);

  if (error) {
    logServerActionError("WORKER HR UPSERT ERROR", error, {
      action: "upsertWorkerHrDetails",
      recordId: workerId,
      table: "workers",
    });
    redirectToHr(
      formatSafeActionError("Worker HR details could not be saved", error),
      "error",
    );
  }

  revalidatePath("/hr");
  redirectToHr("Worker HR details saved.");
}

function revalidateLeaveWorkflow() {
  revalidatePath("/hr");
  revalidatePath("/settings/profile");
  revalidatePath("/settings/profile/vacation-requests");
  revalidatePath("/notifications");
}

export async function approveLeaveRequest(requestId: string, _formData: FormData) {
  void _formData;
  await requireSettingsManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_leave_request", { p_request_id: requestId });
  if (error) {
    logServerActionError("LEAVE REQUEST APPROVE ERROR", error, { requestId });
    redirectToHr(formatSafeActionError("Vacation request could not be approved", error), "error");
  }
  revalidateLeaveWorkflow();
  redirectToHr("Vacation request approved.");
}

export async function rejectLeaveRequest(requestId: string, formData: FormData) {
  await requireSettingsManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_leave_request", {
    p_request_id: requestId,
    p_reason: textValue(formData, "reason"),
  });
  if (error) {
    logServerActionError("LEAVE REQUEST REJECT ERROR", error, { requestId });
    redirectToHr(formatSafeActionError("Vacation request could not be rejected", error), "error");
  }
  revalidateLeaveWorkflow();
  redirectToHr("Vacation request rejected.");
}

export async function returnLeaveRequest(requestId: string, formData: FormData) {
  await requireSettingsManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_leave_request", {
    p_request_id: requestId,
    p_reason: textValue(formData, "reason"),
  });
  if (error) {
    logServerActionError("LEAVE REQUEST RETURN ERROR", error, { requestId });
    redirectToHr(formatSafeActionError("Vacation request could not be returned", error), "error");
  }
  revalidateLeaveWorkflow();
  redirectToHr("Vacation request returned for changes.");
}

export async function cancelApprovedLeaveRequest(requestId: string, formData: FormData) {
  await requireSettingsManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_approved_leave_request", {
    p_request_id: requestId,
    p_reason: textValue(formData, "reason"),
  });
  if (error) {
    logServerActionError("APPROVED LEAVE CANCEL ERROR", error, { requestId });
    redirectToHr(formatSafeActionError("Approved vacation could not be cancelled", error), "error");
  }
  revalidateLeaveWorkflow();
  redirectToHr("Approved vacation cancelled.");
}

export async function createWorkerLeave(workerId: string, formData: FormData) {
  await requireSettingsManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_worker_leave", {
    p_worker_id: workerId,
    p_leave_type: textValue(formData, "leave_type") || "annual_leave",
    p_start_date: textValue(formData, "start_date"),
    p_end_date: textValue(formData, "end_date"),
    p_duration_type: textValue(formData, "duration_type") || "full_day",
    p_reason: optionalTextValue(formData, "reason"),
    p_administrative_note: optionalTextValue(formData, "administrative_note"),
  });
  if (error) {
    logServerActionError("WORKER LEAVE CREATE ERROR", error, { workerId });
    redirectToHr(formatSafeActionError("Worker vacation could not be created", error), "error");
  }
  revalidateLeaveWorkflow();
  redirectToHr("Worker vacation created.");
}

export async function editManagedLeaveRequest(requestId: string, formData: FormData) {
  await requireSettingsManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_managed_leave_request", {
    p_request_id: requestId,
    p_start_date: textValue(formData, "start_date"),
    p_end_date: textValue(formData, "end_date"),
    p_duration_type: textValue(formData, "duration_type") || "full_day",
    p_reason: textValue(formData, "reason"),
    p_administrative_note: optionalTextValue(formData, "administrative_note"),
  });
  if (error) {
    logServerActionError("LEAVE ADMIN EDIT ERROR", error, { requestId });
    redirectToHr(formatSafeActionError("Vacation dates could not be updated", error), "error");
  }
  revalidateLeaveWorkflow();
  redirectToHr("Vacation dates updated.");
}

export async function recordLeaveEarlyReturn(requestId: string, formData: FormData) {
  await requireSettingsManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_leave_early_return", {
    p_request_id: requestId,
    p_actual_end_date: textValue(formData, "actual_end_date"),
    p_return_to_work_date: textValue(formData, "return_to_work_date"),
    p_reason: textValue(formData, "reason"),
  });
  if (error) {
    logServerActionError("LEAVE EARLY RETURN ERROR", error, { requestId });
    redirectToHr(formatSafeActionError("Early return could not be recorded", error), "error");
  }
  revalidateLeaveWorkflow();
  redirectToHr("Early return recorded.");
}

export async function cancelActiveLeave(requestId: string, formData: FormData) {
  await requireSettingsManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_active_leave_request", {
    p_request_id: requestId,
    p_actual_end_date: textValue(formData, "actual_end_date"),
    p_return_to_work_date: textValue(formData, "return_to_work_date"),
    p_reason: textValue(formData, "reason"),
  });
  if (error) {
    logServerActionError("ACTIVE LEAVE CANCEL ERROR", error, { requestId });
    redirectToHr(formatSafeActionError("Active vacation could not be cancelled", error), "error");
  }
  revalidateLeaveWorkflow();
  redirectToHr("Active vacation cancelled with actual dates recorded.");
}

export async function correctLeaveActualDates(requestId: string, formData: FormData) {
  await requireSettingsManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("correct_leave_actual_dates", {
    p_request_id: requestId,
    p_actual_start_date: textValue(formData, "actual_start_date"),
    p_actual_end_date: textValue(formData, "actual_end_date"),
    p_return_to_work_date: optionalTextValue(formData, "return_to_work_date"),
    p_reason: textValue(formData, "reason"),
  });
  if (error) {
    logServerActionError("LEAVE ACTUAL DATE CORRECTION ERROR", error, { requestId });
    redirectToHr(formatSafeActionError("Actual vacation dates could not be corrected", error), "error");
  }
  revalidateLeaveWorkflow();
  redirectToHr("Actual vacation dates corrected.");
}
