"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { requireActiveUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit-log";
import { DEFAULT_QUOTATION_NOTES } from "@/lib/quotations/quotation-pdf-settings";
import { createClient } from "@/lib/supabase/server";

type SettingsMessageType = "success" | "error";
type SettingsMessageScope = "settings" | "profile";

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalTextValue(formData: FormData, name: string) {
  const value = textValue(formData, name);
  return value || null;
}

function numberValue(formData: FormData, name: string, fallback: number) {
  const value = Number.parseFloat(textValue(formData, name));
  return Number.isFinite(value) ? value : fallback;
}

function redirectToSettings(message: string, messageType: SettingsMessageType = "success"): never {
  const query = new URLSearchParams();
  query.set("message", message);
  query.set("messageType", messageType);
  query.set("messageScope", "settings" satisfies SettingsMessageScope);
  redirect(`/settings?${query.toString()}`);
}

function redirectToProfile(message: string, messageType: SettingsMessageType = "success"): never {
  const query = new URLSearchParams();
  query.set("message", message);
  query.set("messageType", messageType);
  query.set("messageScope", "profile" satisfies SettingsMessageScope);
  redirect(`/settings/profile?${query.toString()}`);
}

function actionErrorMessage(actionLabel: string, error: unknown, fallbackMessage?: string) {
  return formatSafeActionError(actionLabel, error, fallbackMessage);
}

// Scoped to company settings only — do not generalize into lib/auth.ts,
// requireSettingsManager() is shared by unrelated callers (quotations
// product-library actions, price updates page) that must stay admin-tier.
async function requireCompanySettingsManager() {
  const authenticatedUser = await requireActiveUser();
  const role = authenticatedUser.profile?.role;

  if (role !== "system_owner" && role !== "admin_manager" && role !== "procurement_manager") {
    redirect("/dashboard");
  }

  return authenticatedUser;
}

async function latestCompanySettingsId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: existingSettings, error: readError } = await supabase
    .from("company_settings")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (readError) {
    logServerActionError("COMPANY SETTINGS LOOKUP ERROR", readError, {
      action: "latestCompanySettingsId",
      table: "company_settings",
    });
    redirectToSettings(actionErrorMessage("Company settings could not be loaded", readError), "error");
  }

  return existingSettings?.id ?? null;
}

async function saveCompanySettingsRecord(
  supabase: Awaited<ReturnType<typeof createClient>>,
  payload: Record<string, unknown>,
) {
  const existingSettingsId = await latestCompanySettingsId(supabase);
  const mutation = existingSettingsId
    ? supabase.from("company_settings").update(payload).eq("id", existingSettingsId)
    : supabase.from("company_settings").insert(payload);

  const { error } = await mutation;

  if (error) {
    logServerActionError("COMPANY SETTINGS SAVE ERROR", error, {
      action: "saveCompanySettingsRecord",
      recordId: existingSettingsId,
      table: "company_settings",
    });
    redirectToSettings(actionErrorMessage("Company settings could not be saved", error), "error");
  }

  return existingSettingsId;
}

export async function updateCompanySettings(formData: FormData) {
  const { user, displayName } = await requireCompanySettingsManager();
  const supabase = await createClient();
  const vatPercent = Math.min(Math.max(numberValue(formData, "vat_percent", 5), 0), 100);
  const payload = {
    company_name: optionalTextValue(formData, "company_name"),
    display_name: optionalTextValue(formData, "display_name"),
    address_line_1: optionalTextValue(formData, "address_line_1"),
    address_line_2: optionalTextValue(formData, "address_line_2"),
    city: optionalTextValue(formData, "city"),
    country: optionalTextValue(formData, "country"),
    trn: optionalTextValue(formData, "trn"),
    phone: optionalTextValue(formData, "phone"),
    email: optionalTextValue(formData, "email"),
    website: optionalTextValue(formData, "website"),
    default_currency: textValue(formData, "default_currency") || "AED",
    vat_percent: vatPercent,
    logo_url: optionalTextValue(formData, "logo_url"),
    updated_by: user.id,
  };
  const existingSettingsId = await saveCompanySettingsRecord(supabase, payload);

  await createAuditLog(supabase, {
    entityType: "company_settings",
    entityId: existingSettingsId,
    action: "company_settings_updated",
    title: "Company settings updated",
    description: payload.display_name ?? payload.company_name ?? "Company profile updated.",
    metadata: {
      companyName: payload.company_name,
      defaultCurrency: payload.default_currency,
      vatPercent,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/settings");
  revalidatePath("/quotations/[id]", "page");
  revalidatePath("/quotations/[id]/pdf", "page");
  revalidatePath("/quotations/[id]/specification", "page");
  redirectToSettings("Company profile saved.");
}

export async function updateDocumentDefaults(formData: FormData) {
  const { user, displayName } = await requireCompanySettingsManager();
  const supabase = await createClient();
  const defaultQuotationNotes = textValue(formData, "default_quotation_notes") || DEFAULT_QUOTATION_NOTES;
  const payload = {
    default_quotation_notes: defaultQuotationNotes,
    updated_by: user.id,
  };
  const existingSettingsId = await saveCompanySettingsRecord(supabase, payload);

  await createAuditLog(supabase, {
    entityType: "company_settings",
    entityId: existingSettingsId,
    action: "company_settings_document_defaults_updated",
    title: "Document defaults updated",
    description: "Quotation document defaults updated.",
    metadata: {
      defaultQuotationNotesLength: defaultQuotationNotes.length,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/settings");
  revalidatePath("/quotations/[id]/pdf", "page");
  revalidatePath("/quotations/[id]/download-pdf", "page");
  redirectToSettings("Document defaults saved.");
}

export async function updateMyProfile(formData: FormData) {
  const { user, displayName } = await requireActiveUser();
  const supabase = await createClient();

  const fullName = optionalTextValue(formData, "full_name");
  const phone = optionalTextValue(formData, "phone");
  const jobTitle = optionalTextValue(formData, "job_title");
  const department = optionalTextValue(formData, "department");
  const profileUpdate = {
    department,
    full_name: fullName,
    job_title: jobTitle,
    phone,
  };

  const { error } = await supabase
    .from("profiles")
    .update(profileUpdate as never)
    .eq("id", user.id);

  if (error) {
    logServerActionError("MY PROFILE UPDATE ERROR", error, {
      action: "updateMyProfile",
      recordId: user.id,
      table: "profiles",
    });
    redirectToProfile(actionErrorMessage("Profile could not be updated", error), "error");
  }

  await createAuditLog(supabase, {
    entityType: "profile",
    entityId: user.id,
    action: "profile_updated",
    title: "Profile updated",
    description: fullName ?? user.email ?? "Profile details updated.",
    metadata: {
      department,
      fullName,
      jobTitle,
      phone,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/settings");
  revalidatePath("/settings/profile");
  redirectToProfile("Profile updated.");
}
