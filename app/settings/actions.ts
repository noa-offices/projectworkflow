"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSettingsManager, requireSystemOwner } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit-log";
import { createAdminClient } from "@/lib/supabase/admin";
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

export async function resetTestData(formData: FormData) {
  const { user, displayName } = await requireSystemOwner();
  const confirmationText = textValue(formData, "confirmation_text");

  if (process.env.NODE_ENV === "production") {
    redirectWithMessage("Reset test data is disabled in production.");
  }

  if (confirmationText !== "RESET TEST DATA") {
    redirectWithMessage("Type RESET TEST DATA to continue.");
  }

  const adminClientResult = createAdminClient();

  if (adminClientResult.error || !adminClientResult.client) {
    redirectWithMessage(adminClientResult.error ?? "Server admin delete is not configured.");
  }

  const adminSupabase = adminClientResult.client;
  const { data: quotations, error: quotationsError } = await adminSupabase
    .from("quotations")
    .select("id,project_id")
    .returns<Array<{ id: string; project_id: string }>>();

  if (quotationsError) {
    console.error("RESET TEST DATA QUOTATIONS ERROR", quotationsError.message);
    redirectWithMessage("Test quotations could not be loaded for reset.");
  }

  const quotationIds = (quotations ?? []).map((quotation) => quotation.id);
  const projectIds = Array.from(new Set((quotations ?? []).map((quotation) => quotation.project_id)));

  if (quotationIds.length) {
    const { data: sections, error: sectionsError } = await adminSupabase
      .from("quotation_sections")
      .select("id")
      .in("quotation_id", quotationIds)
      .returns<Array<{ id: string }>>();

    if (sectionsError) {
      console.error("RESET TEST DATA SECTIONS ERROR", sectionsError.message);
      redirectWithMessage("Test quotation sections could not be loaded for reset.");
    }

    const sectionIds = (sections ?? []).map((section) => section.id);
    const deleteSteps: Array<{
      label: string;
      run: () => Promise<{ error: { message: string } | null }>;
    }> = [
      {
        label: "quotation_item_price_history",
        run: async () => await adminSupabase.from("quotation_item_price_history").delete().in("quotation_id", quotationIds),
      },
      {
        label: "quotation_presentations",
        run: async () => await adminSupabase.from("quotation_presentations").delete().in("quotation_id", quotationIds),
      },
      {
        label: "quotation_procurement_rfqs",
        run: async () => await adminSupabase.from("quotation_procurement_rfqs").delete().in("quotation_id", quotationIds),
      },
      {
        label: "quotation_purchase_orders",
        run: async () => await adminSupabase.from("quotation_purchase_orders").delete().in("quotation_id", quotationIds),
      },
      {
        label: "quotation_order_confirmations",
        run: async () => await adminSupabase.from("quotation_order_confirmations").delete().in("quotation_id", quotationIds),
      },
      {
        label: "audit_activity_log",
        run: async () => await adminSupabase
          .from("audit_activity_log")
          .delete()
          .in("parent_entity_id", quotationIds)
          .eq("parent_entity_type", "quotation"),
      },
      {
        label: "audit_activity_log",
        run: async () => await adminSupabase
          .from("audit_activity_log")
          .delete()
          .in("entity_id", quotationIds)
          .eq("entity_type", "quotation"),
      },
      {
        label: "quotation_items",
        run: async () => sectionIds.length
          ? adminSupabase.from("quotation_items").delete().in("section_id", sectionIds)
          : Promise.resolve({ error: null }),
      },
      {
        label: "quotation_items",
        run: async () => await adminSupabase.from("quotation_items").delete().in("quotation_id", quotationIds),
      },
      {
        label: "quotation_sections",
        run: async () => await adminSupabase.from("quotation_sections").delete().in("quotation_id", quotationIds),
      },
      {
        label: "quotations",
        run: async () => await adminSupabase.from("quotations").delete().in("id", quotationIds),
      },
    ];

    for (const step of deleteSteps) {
      const { error } = await step.run();

      if (error) {
        console.error("RESET TEST DATA DELETE ERROR", step.label, error.message);
        redirectWithMessage(`Test data reset failed in ${step.label}.`);
      }
    }
  }

  if (projectIds.length) {
    const { error: projectAuditError } = await adminSupabase
      .from("audit_activity_log")
      .delete()
      .in("entity_id", projectIds)
      .eq("entity_type", "project");

    if (projectAuditError) {
      console.error("RESET TEST DATA PROJECT AUDIT ERROR", projectAuditError.message);
      redirectWithMessage("Project audit records could not be deleted.");
    }
  }

  const { error: projectsError } = await adminSupabase
    .from("projects")
    .delete()
    .not("id", "is", null);

  if (projectsError) {
    console.error("RESET TEST DATA PROJECTS ERROR", projectsError.message);
    redirectWithMessage("Projects could not be deleted during reset.");
  }

  const supabase = await createClient();
  await createAuditLog(supabase, {
    entityType: "system",
    entityId: null,
    action: "test_data_reset",
    title: "Test data reset",
    description: "Non-production project and quotation data reset.",
    metadata: {
      quotationCount: quotationIds.length,
      projectCount: projectIds.length,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/clients");
  revalidatePath("/quotations");
  revalidatePath("/settings");
  redirectWithMessage("Test project and quotation data reset.");
}
