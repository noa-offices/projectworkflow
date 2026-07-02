"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { requireSettingsManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

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

function buildVacationEntry(formData: FormData): VacationEntry | null {
  const startDate = textValue(formData, "start_date");
  const endDate = textValue(formData, "end_date");
  if (!startDate || !endDate) return null;

  return {
    id: crypto.randomUUID(),
    start_date: startDate,
    end_date: endDate,
    note: optionalTextValue(formData, "note") ?? undefined,
  };
}

function vacationEntryEdits(formData: FormData): Omit<VacationEntry, "id"> | null {
  const startDate = textValue(formData, "start_date");
  const endDate = textValue(formData, "end_date");
  if (!startDate || !endDate) return null;

  return {
    start_date: startDate,
    end_date: endDate,
    note: optionalTextValue(formData, "note") ?? undefined,
  };
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

  revalidatePath("/hr");
  redirectToHr("HR details saved.");
}

export async function upsertWorkerHrDetails(workerId: string, formData: FormData) {
  const { user } = await requireSettingsManager();
  const adminClient = getAdminClient();

  const payload = {
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

export async function addStaffVacationEntry(profileId: string, formData: FormData) {
  const { user } = await requireSettingsManager();
  const adminClient = getAdminClient();

  const entry = buildVacationEntry(formData);
  if (!entry) {
    redirectToHr("Start and end dates are required.", "error");
  }

  const { data: existing, error: readError } = await adminClient
    .from("profiles_hr")
    .select("vacation_dates")
    .eq("profile_id", profileId)
    .maybeSingle<{ vacation_dates: VacationEntry[] | null }>();

  if (readError) {
    logServerActionError("STAFF VACATION READ ERROR", readError, {
      action: "addStaffVacationEntry",
      recordId: profileId,
      table: "profiles_hr",
    });
    redirectToHr(formatSafeActionError("Vacation entry could not be saved", readError), "error");
  }

  const vacationDates = [...(existing?.vacation_dates ?? []), entry];

  const { error } = await adminClient
    .from("profiles_hr")
    .upsert(
      {
        profile_id: profileId,
        vacation_dates: vacationDates,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "profile_id" },
    );

  if (error) {
    logServerActionError("STAFF VACATION ADD ERROR", error, {
      action: "addStaffVacationEntry",
      recordId: profileId,
      table: "profiles_hr",
    });
    redirectToHr(formatSafeActionError("Vacation entry could not be saved", error), "error");
  }

  revalidatePath("/hr");
  redirectToHr("Vacation entry added.");
}

export async function removeStaffVacationEntry(profileId: string, entryId: string, _formData: FormData) {
  const { user } = await requireSettingsManager();
  const adminClient = getAdminClient();

  const { data: existing, error: readError } = await adminClient
    .from("profiles_hr")
    .select("vacation_dates")
    .eq("profile_id", profileId)
    .maybeSingle<{ vacation_dates: VacationEntry[] | null }>();

  if (readError) {
    logServerActionError("STAFF VACATION READ ERROR", readError, {
      action: "removeStaffVacationEntry",
      recordId: profileId,
      table: "profiles_hr",
    });
    redirectToHr(formatSafeActionError("Vacation entry could not be removed", readError), "error");
  }

  const vacationDates = (existing?.vacation_dates ?? []).filter((entry) => entry.id !== entryId);

  const { error } = await adminClient
    .from("profiles_hr")
    .update({
      vacation_dates: vacationDates,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("profile_id", profileId);

  if (error) {
    logServerActionError("STAFF VACATION REMOVE ERROR", error, {
      action: "removeStaffVacationEntry",
      recordId: profileId,
      table: "profiles_hr",
    });
    redirectToHr(formatSafeActionError("Vacation entry could not be removed", error), "error");
  }

  revalidatePath("/hr");
  redirectToHr("Vacation entry removed.");
}

export async function editStaffVacationEntry(profileId: string, entryId: string, formData: FormData) {
  const { user } = await requireSettingsManager();
  const adminClient = getAdminClient();

  const edits = vacationEntryEdits(formData);
  if (!edits) {
    redirectToHr("Start and end dates are required.", "error");
  }

  const { data: existing, error: readError } = await adminClient
    .from("profiles_hr")
    .select("vacation_dates")
    .eq("profile_id", profileId)
    .maybeSingle<{ vacation_dates: VacationEntry[] | null }>();

  if (readError) {
    logServerActionError("STAFF VACATION READ ERROR", readError, {
      action: "editStaffVacationEntry",
      recordId: profileId,
      table: "profiles_hr",
    });
    redirectToHr(formatSafeActionError("Vacation entry could not be updated", readError), "error");
  }

  const vacationDates = (existing?.vacation_dates ?? []).map((entry) =>
    entry.id === entryId ? { ...entry, ...edits } : entry,
  );

  const { error } = await adminClient
    .from("profiles_hr")
    .update({
      vacation_dates: vacationDates,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("profile_id", profileId);

  if (error) {
    logServerActionError("STAFF VACATION EDIT ERROR", error, {
      action: "editStaffVacationEntry",
      recordId: profileId,
      table: "profiles_hr",
    });
    redirectToHr(formatSafeActionError("Vacation entry could not be updated", error), "error");
  }

  revalidatePath("/hr");
  redirectToHr("Vacation entry updated.");
}

export async function addWorkerVacationEntry(workerId: string, formData: FormData) {
  const { user } = await requireSettingsManager();
  const adminClient = getAdminClient();

  const entry = buildVacationEntry(formData);
  if (!entry) {
    redirectToHr("Start and end dates are required.", "error");
  }

  const { data: existing, error: readError } = await adminClient
    .from("workers")
    .select("vacation_dates")
    .eq("id", workerId)
    .maybeSingle<{ vacation_dates: VacationEntry[] | null }>();

  if (readError) {
    logServerActionError("WORKER VACATION READ ERROR", readError, {
      action: "addWorkerVacationEntry",
      recordId: workerId,
      table: "workers",
    });
    redirectToHr(formatSafeActionError("Vacation entry could not be saved", readError), "error");
  }

  const vacationDates = [...(existing?.vacation_dates ?? []), entry];

  const { error } = await adminClient
    .from("workers")
    .update({
      vacation_dates: vacationDates,
      updated_by: user.id,
    } as never)
    .eq("id", workerId);

  if (error) {
    logServerActionError("WORKER VACATION ADD ERROR", error, {
      action: "addWorkerVacationEntry",
      recordId: workerId,
      table: "workers",
    });
    redirectToHr(formatSafeActionError("Vacation entry could not be saved", error), "error");
  }

  revalidatePath("/hr");
  redirectToHr("Vacation entry added.");
}

export async function removeWorkerVacationEntry(workerId: string, entryId: string, _formData: FormData) {
  const { user } = await requireSettingsManager();
  const adminClient = getAdminClient();

  const { data: existing, error: readError } = await adminClient
    .from("workers")
    .select("vacation_dates")
    .eq("id", workerId)
    .maybeSingle<{ vacation_dates: VacationEntry[] | null }>();

  if (readError) {
    logServerActionError("WORKER VACATION READ ERROR", readError, {
      action: "removeWorkerVacationEntry",
      recordId: workerId,
      table: "workers",
    });
    redirectToHr(formatSafeActionError("Vacation entry could not be removed", readError), "error");
  }

  const vacationDates = (existing?.vacation_dates ?? []).filter((entry) => entry.id !== entryId);

  const { error } = await adminClient
    .from("workers")
    .update({
      vacation_dates: vacationDates,
      updated_by: user.id,
    } as never)
    .eq("id", workerId);

  if (error) {
    logServerActionError("WORKER VACATION REMOVE ERROR", error, {
      action: "removeWorkerVacationEntry",
      recordId: workerId,
      table: "workers",
    });
    redirectToHr(formatSafeActionError("Vacation entry could not be removed", error), "error");
  }

  revalidatePath("/hr");
  redirectToHr("Vacation entry removed.");
}

export async function editWorkerVacationEntry(workerId: string, entryId: string, formData: FormData) {
  const { user } = await requireSettingsManager();
  const adminClient = getAdminClient();

  const edits = vacationEntryEdits(formData);
  if (!edits) {
    redirectToHr("Start and end dates are required.", "error");
  }

  const { data: existing, error: readError } = await adminClient
    .from("workers")
    .select("vacation_dates")
    .eq("id", workerId)
    .maybeSingle<{ vacation_dates: VacationEntry[] | null }>();

  if (readError) {
    logServerActionError("WORKER VACATION READ ERROR", readError, {
      action: "editWorkerVacationEntry",
      recordId: workerId,
      table: "workers",
    });
    redirectToHr(formatSafeActionError("Vacation entry could not be updated", readError), "error");
  }

  const vacationDates = (existing?.vacation_dates ?? []).map((entry) =>
    entry.id === entryId ? { ...entry, ...edits } : entry,
  );

  const { error } = await adminClient
    .from("workers")
    .update({
      vacation_dates: vacationDates,
      updated_by: user.id,
    } as never)
    .eq("id", workerId);

  if (error) {
    logServerActionError("WORKER VACATION EDIT ERROR", error, {
      action: "editWorkerVacationEntry",
      recordId: workerId,
      table: "workers",
    });
    redirectToHr(formatSafeActionError("Vacation entry could not be updated", error), "error");
  }

  revalidatePath("/hr");
  redirectToHr("Vacation entry updated.");
}
