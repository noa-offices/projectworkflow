"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const REQUESTS_PATH = "/settings/profile/vacation-requests";

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function requestValues(formData: FormData) {
  return {
    p_leave_type: textValue(formData, "leave_type"),
    p_start_date: textValue(formData, "start_date"),
    p_end_date: textValue(formData, "end_date"),
    p_duration_type: textValue(formData, "duration_type") || "full_day",
    p_reason: textValue(formData, "reason") || null,
    p_handover_note: textValue(formData, "handover_note") || null,
  };
}

function redirectToRequests(message: string, type: "success" | "error" = "success"): never {
  const query = new URLSearchParams({ message, messageType: type });
  redirect(`${REQUESTS_PATH}?${query.toString()}`);
}

function refreshLeavePages() {
  revalidatePath(REQUESTS_PATH);
  revalidatePath("/settings/profile");
  revalidatePath("/hr");
  revalidatePath("/notifications");
}

export async function createLeaveRequest(formData: FormData) {
  await requireActiveUser();
  const supabase = await createClient();
  const values = requestValues(formData);
  const { data, error } = await supabase.rpc("create_leave_request", values);
  if (error) {
    logServerActionError("LEAVE REQUEST CREATE ERROR", error, { action: "createLeaveRequest" });
    redirectToRequests(formatSafeActionError("Vacation request could not be saved", error), "error");
  }

  const requestId = data as string;
  if (textValue(formData, "intent") === "submit") {
    const { error: submitError } = await supabase.rpc("submit_leave_request", {
      p_request_id: requestId,
    });
    if (submitError) {
      logServerActionError("LEAVE REQUEST SUBMIT ERROR", submitError, { requestId });
      refreshLeavePages();
      redirectToRequests(
        `Draft saved. ${formatSafeActionError("Submission failed", submitError)}`,
        "error",
      );
    }
  }

  refreshLeavePages();
  redirectToRequests(textValue(formData, "intent") === "submit" ? "Vacation request submitted." : "Vacation draft saved.");
}

export async function updateLeaveRequest(requestId: string, formData: FormData) {
  await requireActiveUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_leave_request", {
    p_request_id: requestId,
    ...requestValues(formData),
  });
  if (error) {
    logServerActionError("LEAVE REQUEST UPDATE ERROR", error, { requestId });
    redirectToRequests(formatSafeActionError("Vacation request could not be updated", error), "error");
  }

  if (textValue(formData, "intent") === "submit") {
    const { error: submitError } = await supabase.rpc("submit_leave_request", {
      p_request_id: requestId,
    });
    if (submitError) {
      logServerActionError("LEAVE REQUEST SUBMIT ERROR", submitError, { requestId });
      refreshLeavePages();
      redirectToRequests(formatSafeActionError("Changes saved but submission failed", submitError), "error");
    }
  }

  refreshLeavePages();
  redirectToRequests(textValue(formData, "intent") === "submit" ? "Vacation request submitted." : "Vacation request updated.");
}

export async function submitLeaveRequest(requestId: string, _formData: FormData) {
  void _formData;
  await requireActiveUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_leave_request", { p_request_id: requestId });
  if (error) {
    logServerActionError("LEAVE REQUEST SUBMIT ERROR", error, { requestId });
    redirectToRequests(formatSafeActionError("Vacation request could not be submitted", error), "error");
  }
  refreshLeavePages();
  redirectToRequests("Vacation request submitted.");
}

export async function cancelMyLeaveRequest(requestId: string, formData: FormData) {
  await requireActiveUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_my_leave_request", {
    p_request_id: requestId,
    p_reason: textValue(formData, "reason") || null,
  });
  if (error) {
    logServerActionError("LEAVE REQUEST CANCEL ERROR", error, { requestId });
    redirectToRequests(formatSafeActionError("Vacation request could not be cancelled", error), "error");
  }
  refreshLeavePages();
  redirectToRequests("Vacation request cancelled.");
}

export async function remindLeaveRequest(requestId: string, _formData: FormData) {
  void _formData;
  await requireActiveUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remind_leave_request", { p_request_id: requestId });
  if (error) {
    logServerActionError("LEAVE REQUEST REMINDER ERROR", error, { requestId });
    redirectToRequests(formatSafeActionError("Reminder could not be sent", error), "error");
  }
  refreshLeavePages();
  redirectToRequests("Vacation approval reminder sent.");
}
