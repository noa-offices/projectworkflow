"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRecordsManager } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

const projectStatuses = new Set(["active", "on_hold", "completed", "cancelled"]);

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalTextValue(formData: FormData, name: string) {
  const value = textValue(formData, name);
  return value || null;
}

function boolValue(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function optionalNumberValue(formData: FormData, name: string) {
  const value = textValue(formData, name);

  if (!value) {
    return null;
  }

  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function redirectWithMessage(message: string): never {
  redirect(`/clients?message=${encodeURIComponent(message)}`);
}

function clientPayload(formData: FormData, userId?: string) {
  const payload = {
    company_name: textValue(formData, "company_name"),
    client_code: optionalTextValue(formData, "client_code"),
    contact_person: optionalTextValue(formData, "contact_person"),
    email: optionalTextValue(formData, "email"),
    phone: optionalTextValue(formData, "phone"),
    website: optionalTextValue(formData, "website"),
    address: optionalTextValue(formData, "address"),
    city: optionalTextValue(formData, "city"),
    country: textValue(formData, "country") || "UAE",
    trn: optionalTextValue(formData, "trn"),
    notes: optionalTextValue(formData, "notes"),
    is_active: boolValue(formData, "is_active"),
  };

  return userId ? { ...payload, created_by: userId } : payload;
}

function projectPayload(formData: FormData, userId?: string) {
  const payload = {
    client_id: textValue(formData, "client_id"),
    project_name: textValue(formData, "project_name"),
    project_year: optionalNumberValue(formData, "project_year"),
    project_code: optionalTextValue(formData, "project_code"),
    location: optionalTextValue(formData, "location"),
    consultant: optionalTextValue(formData, "consultant"),
    contractor: optionalTextValue(formData, "contractor"),
    attention_to: optionalTextValue(formData, "attention_to"),
    attention_mobile: optionalTextValue(formData, "attention_mobile"),
    attention_landline: optionalTextValue(formData, "attention_landline"),
    attention_email: optionalTextValue(formData, "attention_email"),
    po_box: optionalTextValue(formData, "po_box"),
    project_address: optionalTextValue(formData, "project_address"),
    project_status: textValue(formData, "project_status") || "active",
    notes: optionalTextValue(formData, "notes"),
    is_active: boolValue(formData, "is_active"),
  };

  return userId ? { ...payload, created_by: userId } : payload;
}

function validateProjectYear(formData: FormData, projectYear: number | null) {
  const rawYear = textValue(formData, "project_year");

  if (!rawYear) {
    return;
  }

  if (projectYear === null || projectYear < 2000 || projectYear > 2100) {
    redirectWithMessage("Project year must be between 2000 and 2100.");
  }
}

export async function createClient(formData: FormData) {
  const { user } = await requireRecordsManager();
  const payload = clientPayload(formData, user.id);

  if (!payload.company_name) {
    redirectWithMessage("Company name is required.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("clients").insert(payload);

  if (error) {
    console.error("CLIENT CREATE ERROR", error.message);
    redirectWithMessage("Client could not be created.");
  }

  revalidatePath("/clients");
  redirectWithMessage("Client created.");
}

export async function updateClient(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const payload = clientPayload(formData);

  if (!id || !payload.company_name) {
    redirectWithMessage("Client id and company name are required.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("clients").update(payload).eq("id", id);

  if (error) {
    console.error("CLIENT UPDATE ERROR", error.message);
    redirectWithMessage("Client could not be updated.");
  }

  revalidatePath("/clients");
  redirectWithMessage("Client updated.");
}

export async function createProject(formData: FormData) {
  const { user } = await requireRecordsManager();
  const payload = projectPayload(formData, user.id);

  if (!payload.client_id || !payload.project_name) {
    redirectWithMessage("Client and project name are required.");
  }

  if (!projectStatuses.has(payload.project_status)) {
    redirectWithMessage("Select a valid project status.");
  }

  validateProjectYear(formData, payload.project_year);

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("projects").insert(payload);

  if (error) {
    console.error("PROJECT CREATE ERROR", error.message);
    redirectWithMessage("Project could not be created.");
  }

  revalidatePath("/clients");
  redirectWithMessage("Project created.");
}

export async function updateProject(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const payload = projectPayload(formData);

  if (!id || !payload.client_id || !payload.project_name) {
    redirectWithMessage("Project id, client, and project name are required.");
  }

  if (!projectStatuses.has(payload.project_status)) {
    redirectWithMessage("Select a valid project status.");
  }

  validateProjectYear(formData, payload.project_year);

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("projects").update(payload).eq("id", id);

  if (error) {
    console.error("PROJECT UPDATE ERROR", error.message);
    redirectWithMessage("Project could not be updated.");
  }

  revalidatePath("/clients");
  redirectWithMessage("Project updated.");
}
