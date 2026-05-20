"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRecordsManager } from "@/lib/auth";
import { createAdminClient as createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

const projectStatuses = new Set(["active", "on_hold", "completed", "cancelled"]);
type ClientsMessageTone = "success" | "error" | "warning";

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

function redirectWithMessage(message: string, tone: ClientsMessageTone = "success"): never {
  const query = new URLSearchParams();
  query.set("message", message);
  query.set("messageType", tone);
  redirect(`/clients?${query.toString()}`);
}

function redirectToClients(
  message: string,
  params: Record<string, string> = {},
  tone: ClientsMessageTone = "success",
): never {
  const query = new URLSearchParams(params);
  query.set("message", message);
  query.set("messageType", tone);
  redirect(`/clients?${query.toString()}`);
}

function safeSupabaseErrorReason(error: { code?: string | null; message?: string | null; details?: string | null }) {
  const detail = [error.code, error.message, error.details].filter(Boolean).join(" - ");
  return detail || "unknown server error";
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
    redirectWithMessage("Project year must be between 2000 and 2100.", "error");
  }
}

export async function createClient(formData: FormData) {
  const { user } = await requireRecordsManager();
  const payload = clientPayload(formData, user.id);

  if (!payload.company_name) {
    redirectWithMessage("Company name is required.", "error");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("clients").insert(payload);

  if (error) {
    console.error("CLIENT CREATE ERROR", error.message);
    redirectWithMessage("Client could not be created.", "error");
  }

  revalidatePath("/clients");
  redirectWithMessage("Client created.");
}

export async function updateClient(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const payload = clientPayload(formData);

  if (!id || !payload.company_name) {
    redirectWithMessage("Client id and company name are required.", "error");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("clients").update(payload).eq("id", id);

  if (error) {
    console.error("CLIENT UPDATE ERROR", error.message);
    redirectWithMessage("Client could not be updated.", "error");
  }

  revalidatePath("/clients");
  redirectWithMessage("Client updated.");
}

export async function createProject(formData: FormData) {
  const { user } = await requireRecordsManager();
  const payload = projectPayload(formData, user.id);

  if (!payload.client_id || !payload.project_name) {
    redirectWithMessage("Client and project name are required.", "error");
  }

  if (!projectStatuses.has(payload.project_status)) {
    redirectWithMessage("Select a valid project status.", "error");
  }

  validateProjectYear(formData, payload.project_year);

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("projects").insert(payload);

  if (error) {
    console.error("PROJECT CREATE ERROR", error.message);
    redirectWithMessage("Project could not be created.", "error");
  }

  revalidatePath("/clients");
  redirectWithMessage("Project created.");
}

export async function updateProject(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const payload = projectPayload(formData);

  if (!id || !payload.client_id || !payload.project_name) {
    redirectWithMessage("Project id, client, and project name are required.", "error");
  }

  if (!projectStatuses.has(payload.project_status)) {
    redirectWithMessage("Select a valid project status.", "error");
  }

  validateProjectYear(formData, payload.project_year);

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("projects").update(payload).eq("id", id);

  if (error) {
    console.error("PROJECT UPDATE ERROR", error.message);
    redirectWithMessage("Project could not be updated.", "error");
  }

  revalidatePath("/clients");
  redirectWithMessage("Project updated.");
}

export async function deactivateProject(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Project id is required.", "error");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("projects")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("PROJECT DEACTIVATE ERROR", error.message);
    redirectWithMessage("Project could not be deactivated.", "error");
  }

  revalidatePath("/clients");
  redirectWithMessage("Project moved to Archive. Linked quotations were not deleted.", "warning");
}

export async function restoreProject(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectToClients("Project id is required.", { tab: "archive" }, "error");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("projects")
    .update({ is_active: true })
    .eq("id", id);

  if (error) {
    console.error("PROJECT RESTORE ERROR", error.message);
    redirectToClients("Project could not be restored.", { tab: "archive" }, "error");
  }

  revalidatePath("/clients");
  redirectToClients("Project restored.", { tab: "archive" });
}

export async function permanentlyDeleteProject(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectToClients("Project id is required.", { tab: "archive" }, "error");
  }

  const supabase = await createSupabaseClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id,is_active")
    .eq("id", id)
    .maybeSingle<{ id: string; is_active: boolean }>();

  if (projectError) {
    console.error("PROJECT PERMANENT DELETE READ ERROR", projectError.message);
    redirectToClients("Project could not be loaded for deletion.", { tab: "archive" }, "error");
  }

  if (!project) {
    redirectToClients("Project could not be deleted because it was not found.", { tab: "archive" }, "error");
  }

  if (project.is_active) {
    redirectToClients("Archive this project before permanently deleting it.", { tab: "archive" }, "warning");
  }

  const { count, error: countError } = await supabase
    .from("quotations")
    .select("id", { count: "exact", head: true })
    .eq("project_id", id);

  if (countError) {
    console.error("PROJECT QUOTATION DEPENDENCY CHECK ERROR", countError.message);
    redirectToClients("Project dependencies could not be checked.", { tab: "archive" }, "error");
  }

  if ((count ?? 0) > 0) {
    redirectToClients("This project has linked quotations. Keep it archived.", {
      tab: "archive",
    }, "warning");
  }

  const adminClientResult = createSupabaseAdminClient();

  if (adminClientResult.error || !adminClientResult.client) {
    console.error("PROJECT PERMANENT DELETE ADMIN CONFIG ERROR", adminClientResult.error);
    redirectToClients(adminClientResult.error ?? "Server admin delete is not configured.", { tab: "archive" }, "error");
  }

  const adminSupabase = adminClientResult.client;

  const { error } = await adminSupabase.from("projects").delete().eq("id", id).eq("is_active", false);

  if (error) {
    console.error("PROJECT PERMANENT DELETE ERROR", error.message);
    redirectToClients("Project could not be permanently deleted.", { tab: "archive" }, "error");
  }

  revalidatePath("/clients");
  redirectToClients("Project permanently deleted.", { tab: "archive" });
}

async function deleteQuotationsByIds(
  quotationIds: string[],
  projectId: string,
  supabase: SupabaseClient,
) {
  if (!quotationIds.length) {
    return;
  }

  const { data: sections, error: sectionsReadError } = await supabase
    .from("quotation_sections")
    .select("id")
    .in("quotation_id", quotationIds)
    .returns<Array<{ id: string }>>();

  if (sectionsReadError) {
    console.error("PROJECT DELETE QUOTATION SECTIONS READ ERROR", sectionsReadError.message);
    redirectToClients(
      `Could not delete because linked quotation data still exists in quotation_sections: ${sectionsReadError.message}`,
      { tab: "archive" },
      "error",
    );
  }

  const sectionIds = (sections ?? []).map((section) => section.id);

  const deleteSteps: Array<{
    label: string;
    run: () => Promise<{ error: { message: string } | null }>;
  }> = [
    {
      label: "quotation_item_price_history",
      run: async () => await supabase.from("quotation_item_price_history").delete().in("quotation_id", quotationIds),
    },
    {
      label: "quotation_presentations",
      run: async () => await supabase.from("quotation_presentations").delete().in("quotation_id", quotationIds),
    },
    {
      label: "quotation_procurement_rfqs",
      run: async () => await supabase.from("quotation_procurement_rfqs").delete().in("quotation_id", quotationIds),
    },
    {
      label: "quotation_purchase_orders",
      run: async () => await supabase.from("quotation_purchase_orders").delete().in("quotation_id", quotationIds),
    },
    {
      label: "quotation_order_confirmations",
      run: async () => await supabase.from("quotation_order_confirmations").delete().in("quotation_id", quotationIds),
    },
    {
      label: "audit_activity_log",
      run: async () => await supabase
        .from("audit_activity_log")
        .delete()
        .in("parent_entity_id", quotationIds)
        .eq("parent_entity_type", "quotation"),
    },
    {
      label: "audit_activity_log",
      run: async () => await supabase
        .from("audit_activity_log")
        .delete()
        .in("entity_id", quotationIds)
        .eq("entity_type", "quotation"),
    },
    {
      label: "quotation_items",
      run: async () => sectionIds.length
        ? supabase.from("quotation_items").delete().in("section_id", sectionIds)
        : Promise.resolve({ error: null }),
    },
    {
      label: "quotation_items",
      run: async () => await supabase.from("quotation_items").delete().in("quotation_id", quotationIds),
    },
    {
      label: "quotation_sections",
      run: async () => await supabase.from("quotation_sections").delete().in("quotation_id", quotationIds),
    },
    {
      label: "quotations",
      run: async () => await supabase.from("quotations").delete().eq("project_id", projectId),
    },
  ];

  for (const step of deleteSteps) {
    const { error } = await step.run();

    if (error) {
      console.error(`PROJECT DELETE ${step.label.toUpperCase()} ERROR`, error.message);
      redirectToClients(
        `Could not delete because linked quotation data still exists in ${step.label}: ${error.message}`,
        { tab: "archive" },
        "error",
      );
    }
  }
}

export async function permanentlyDeleteProjectAndLinkedQuotations(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const confirmationText = textValue(formData, "confirmation_text");

  if (!id) {
    redirectToClients("Project id is required.", { tab: "archive" }, "error");
  }

  const supabase = await createSupabaseClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id,project_name,is_active")
    .eq("id", id)
    .maybeSingle<{ id: string; is_active: boolean; project_name: string }>();

  if (projectError) {
    console.error("PROJECT CASCADE DELETE READ ERROR", projectError.message);
    redirectToClients("Project could not be loaded for deletion.", { tab: "archive" }, "error");
  }

  if (!project) {
    redirectToClients("Project could not be deleted because it was not found.", { tab: "archive" }, "error");
  }

  if (confirmationText !== project.project_name && confirmationText !== "DELETE PROJECT") {
    redirectToClients("Type the project name exactly or DELETE PROJECT to continue.", { tab: "archive" }, "warning");
  }

  if (project.is_active) {
    redirectToClients("Archive this project before permanently deleting it.", { tab: "archive" }, "warning");
  }

  const adminClientResult = createSupabaseAdminClient();

  if (adminClientResult.error || !adminClientResult.client) {
    console.error("PROJECT CASCADE DELETE ADMIN CONFIG ERROR", adminClientResult.error);
    redirectToClients(adminClientResult.error ?? "Server admin delete is not configured.", { tab: "archive" }, "error");
  }

  const adminSupabase = adminClientResult.client;

  const { data: quotations, error: quotationsError } = await adminSupabase
    .from("quotations")
    .select("id")
    .eq("project_id", id)
    .returns<Array<{ id: string }>>();

  if (quotationsError) {
    const safeReason = safeSupabaseErrorReason(quotationsError);
    console.error("PROJECT CASCADE DELETE QUOTATIONS READ ERROR", safeReason);
    redirectToClients(`Linked quotations could not be loaded for deletion: ${safeReason}`, { tab: "archive" }, "error");
  }

  const quotationIds = (quotations ?? []).map((quotation) => quotation.id);

  await deleteQuotationsByIds(quotationIds, id, adminSupabase);

  const { error: projectAuditError } = await adminSupabase
    .from("audit_activity_log")
    .delete()
    .eq("entity_type", "project")
    .eq("entity_id", id);

  if (projectAuditError) {
    console.error("PROJECT CASCADE DELETE PROJECT AUDIT ERROR", projectAuditError.message);
    redirectToClients(
      `Could not delete because linked quotation data still exists in audit_activity_log: ${projectAuditError.message}`,
      { tab: "archive" },
      "error",
    );
  }

  const { error: deleteProjectError } = await adminSupabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("is_active", false);

  if (deleteProjectError) {
    console.error("PROJECT CASCADE DELETE ERROR", deleteProjectError.message);
    redirectToClients(
      `Project could not be permanently deleted: ${deleteProjectError.message}`,
      { tab: "archive" },
      "error",
    );
  }

  revalidatePath("/clients");
  revalidatePath("/quotations");
  revalidatePath(`/clients/projects/${id}`);
  quotationIds.forEach((quotationId) => {
    revalidatePath(`/quotations/${quotationId}`);
    revalidatePath(`/quotations/${quotationId}/builder`);
    revalidatePath(`/quotations/${quotationId}/local-builder`);
    revalidatePath(`/quotations/${quotationId}/procurement-rfq`);
    revalidatePath(`/quotations/${quotationId}/purchase-order`);
    revalidatePath(`/quotations/${quotationId}/order-confirmation`);
    revalidatePath(`/quotations/${quotationId}/presentation`);
    revalidatePath(`/quotations/${quotationId}/specification`);
  });
  redirectToClients("Project and linked quotations were permanently deleted.", { tab: "archive" });
}

export async function deactivateClient(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Client id is required.", "error");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("clients")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("CLIENT DEACTIVATE ERROR", error.message);
    redirectWithMessage("Client could not be moved to Archive.", "error");
  }

  revalidatePath("/clients");
  redirectWithMessage("Client moved to Archive. Linked projects and quotations were not deleted.", "warning");
}

export async function restoreClient(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectToClients("Client id is required.", { tab: "archive" }, "error");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("clients")
    .update({ is_active: true })
    .eq("id", id);

  if (error) {
    console.error("CLIENT RESTORE ERROR", error.message);
    redirectToClients("Client could not be restored.", { tab: "archive" }, "error");
  }

  revalidatePath("/clients");
  redirectToClients("Client restored.", { tab: "archive" });
}

export async function permanentlyDeleteClient(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectToClients("Client id is required.", { tab: "archive" }, "error");
  }

  const supabase = await createSupabaseClient();
  const { count: projectCount, error: projectCountError } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("client_id", id);
  const { count: quotationCount, error: quotationCountError } = await supabase
    .from("quotations")
    .select("id", { count: "exact", head: true })
    .eq("client_id", id);

  if (projectCountError || quotationCountError) {
    console.error(
      "CLIENT DEPENDENCY CHECK ERROR",
      projectCountError?.message ?? quotationCountError?.message,
    );
    redirectToClients("Client dependencies could not be checked.", { tab: "archive" }, "error");
  }

  if ((projectCount ?? 0) > 0 || (quotationCount ?? 0) > 0) {
    redirectToClients("This client has linked projects or quotations. Keep it archived.", {
      tab: "archive",
    }, "warning");
  }

  const { error } = await supabase.from("clients").delete().eq("id", id);

  if (error) {
    console.error("CLIENT PERMANENT DELETE ERROR", error.message);
    redirectToClients("Client could not be permanently deleted.", { tab: "archive" }, "error");
  }

  revalidatePath("/clients");
  redirectToClients("Client permanently deleted.", { tab: "archive" });
}
