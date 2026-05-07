"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSettingsManager } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit-log";
import { createClient } from "@/lib/supabase/server";

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

function redirectWithMessage(message: string): never {
  redirect(`/settings?message=${encodeURIComponent(message)}`);
}

export async function updateCompanySettings(formData: FormData) {
  const { user, displayName } = await requireSettingsManager();
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

  const { data: existingSettings, error: readError } = await supabase
    .from("company_settings")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (readError) {
    console.error("COMPANY SETTINGS LOOKUP ERROR", readError.message);
    redirectWithMessage("Company settings could not be loaded.");
  }

  const mutation = existingSettings?.id
    ? supabase.from("company_settings").update(payload).eq("id", existingSettings.id)
    : supabase.from("company_settings").insert(payload);

  const { error } = await mutation;

  if (error) {
    console.error("COMPANY SETTINGS SAVE ERROR", error.message);
    redirectWithMessage("Company settings could not be saved.");
  }

  await createAuditLog(supabase, {
    entityType: "company_settings",
    entityId: existingSettings?.id ?? null,
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
  redirectWithMessage("Company profile saved.");
}
