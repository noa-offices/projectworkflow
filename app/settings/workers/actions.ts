"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { requireSettingsManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkerRow = {
  id: string;
  full_name: string;
  phone: string | null;
  nationality: string | null;
  trade: string | null;
  daily_rate: number | null;
  emirates_id_number: string | null;
  emirates_id_expiry: string | null;
  passport_number: string | null;
  passport_expiry: string | null;
  status: "active" | "on_leave" | "offboarded";
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
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

function optionalNumberValue(formData: FormData, name: string) {
  const raw = textValue(formData, name);
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function workerStatus(formData: FormData): WorkerRow["status"] {
  const value = textValue(formData, "status");
  return value === "on_leave" || value === "offboarded" ? value : "active";
}

function redirectToWorkers(message: string, messageType: "success" | "error" = "success"): never {
  const query = new URLSearchParams();
  query.set("message", message);
  query.set("messageType", messageType);
  redirect(`/settings/workers?${query.toString()}`);
}

function getAdminClient() {
  const result = createAdminClient();
  if (!result.client) throw new Error(result.error ?? "Admin client unavailable");
  return result.client;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function createWorker(formData: FormData) {
  const { user } = await requireSettingsManager();
  const adminClient = getAdminClient();

  const fullName = textValue(formData, "full_name");
  if (!fullName) {
    redirectToWorkers("Worker name is required.", "error");
  }

  const payload = {
    full_name: fullName,
    phone: optionalTextValue(formData, "phone"),
    nationality: optionalTextValue(formData, "nationality"),
    trade: optionalTextValue(formData, "trade"),
    daily_rate: optionalNumberValue(formData, "daily_rate"),
    emirates_id_number: optionalTextValue(formData, "emirates_id_number"),
    emirates_id_expiry: optionalTextValue(formData, "emirates_id_expiry"),
    passport_number: optionalTextValue(formData, "passport_number"),
    passport_expiry: optionalTextValue(formData, "passport_expiry"),
    status: workerStatus(formData),
    notes: optionalTextValue(formData, "notes"),
    created_by: user.id,
    updated_by: user.id,
  };

  const { error } = await adminClient.from("workers").insert(payload as never);

  if (error) {
    logServerActionError("WORKER CREATE ERROR", error, {
      action: "createWorker",
      table: "workers",
    });
    redirectToWorkers(
      formatSafeActionError("Worker could not be created", error),
      "error",
    );
  }

  revalidatePath("/settings/workers");
  redirectToWorkers("Worker added.");
}

export async function updateWorker(workerId: string, formData: FormData) {
  const { user } = await requireSettingsManager();
  const adminClient = getAdminClient();

  const fullName = textValue(formData, "full_name");
  if (!fullName) {
    redirectToWorkers("Worker name is required.", "error");
  }

  const payload = {
    full_name: fullName,
    phone: optionalTextValue(formData, "phone"),
    nationality: optionalTextValue(formData, "nationality"),
    trade: optionalTextValue(formData, "trade"),
    daily_rate: optionalNumberValue(formData, "daily_rate"),
    emirates_id_number: optionalTextValue(formData, "emirates_id_number"),
    emirates_id_expiry: optionalTextValue(formData, "emirates_id_expiry"),
    passport_number: optionalTextValue(formData, "passport_number"),
    passport_expiry: optionalTextValue(formData, "passport_expiry"),
    status: workerStatus(formData),
    notes: optionalTextValue(formData, "notes"),
    updated_by: user.id,
  };

  const { error } = await adminClient
    .from("workers")
    .update(payload as never)
    .eq("id", workerId);

  if (error) {
    logServerActionError("WORKER UPDATE ERROR", error, {
      action: "updateWorker",
      recordId: workerId,
      table: "workers",
    });
    redirectToWorkers(
      formatSafeActionError("Worker could not be updated", error),
      "error",
    );
  }

  revalidatePath("/settings/workers");
  redirectToWorkers("Worker updated.");
}

export async function deleteWorker(workerId: string, _formData: FormData) {
  const { user } = await requireSettingsManager();
  const adminClient = getAdminClient();

  const { error } = await adminClient
    .from("workers")
    .update({ status: "offboarded", updated_by: user.id } as never)
    .eq("id", workerId);

  if (error) {
    logServerActionError("WORKER OFFBOARD ERROR", error, {
      action: "deleteWorker",
      recordId: workerId,
      table: "workers",
    });
    redirectToWorkers(
      formatSafeActionError("Worker could not be offboarded", error),
      "error",
    );
  }

  revalidatePath("/settings/workers");
  redirectToWorkers("Worker offboarded.");
}
