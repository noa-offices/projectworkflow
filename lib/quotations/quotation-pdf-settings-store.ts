import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { normalizeQuotationPdfSettings } from "@/lib/quotations/quotation-pdf-settings";

type ProfileRecord = {
  role: string | null;
  account_status: string | null;
};

type QuotationRecord = {
  id: string;
};

type QuotationPdfSettingsRecord = {
  settings_json: unknown;
  updated_at: string;
};

type SupabaseLikeError = {
  code?: string;
  details?: string | null;
  hint?: string | null;
  message?: string;
};

type AuthFailure = {
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>;
  error: string;
  status: number;
  details?: string;
  code?: string;
};

type ActiveUserAuthSuccess = {
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>;
  user: { id: string };
  profile: ProfileRecord | null;
};

type SaveResult =
  | { success: true; settings: ReturnType<typeof normalizeQuotationPdfSettings> }
  | { success: false; status: number; error: string; details?: string; code?: string };

type LoadResult =
  | { success: true; hasStoredSettings: boolean; settings: ReturnType<typeof normalizeQuotationPdfSettings> }
  | { success: false; status: number; error: string; details?: string; code?: string };

function supabaseErrorDetails(error: SupabaseLikeError | null | undefined) {
  if (!error) return null;

  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" | ") || null;
}

async function activeUser(): Promise<AuthFailure | ActiveUserAuthSuccess> {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, error: "Unauthorized.", status: 401 } satisfies AuthFailure;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,account_status")
    .eq("id", user.id)
    .maybeSingle<ProfileRecord>();

  if (profileError) {
    logServerActionError("QUOTATION PDF SETTINGS PROFILE ERROR", profileError, {
      action: "loadQuotationPdfSettings.activeUser",
      table: "profiles",
      recordId: user.id,
    });
    return {
      supabase,
      error: formatSafeActionError("Failed to verify user permissions", profileError),
      status: 500,
      details: supabaseErrorDetails(profileError) ?? profileError.message,
      code: profileError.code,
    } satisfies AuthFailure;
  }

  if (profile?.account_status !== "active") {
    return { supabase, error: "Forbidden.", status: 403 } satisfies AuthFailure;
  }

  return { supabase, user: { id: user.id }, profile } satisfies ActiveUserAuthSuccess;
}

function canManageRecords(profile: ProfileRecord | null) {
  return ["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator", "designer"].includes(profile?.role ?? "");
}

export async function loadQuotationPdfSettings(quotationId: string): Promise<LoadResult> {
  const auth = await activeUser();
  if ("error" in auth) {
    return auth.details
      ? { success: false, status: auth.status, error: auth.error, details: auth.details, code: auth.code }
      : { success: false, status: auth.status, error: auth.error, code: auth.code };
  }

  const { data, error } = await auth.supabase
    .from("quotation_pdfs")
    .select("settings_json,updated_at")
    .eq("quotation_id", quotationId)
    .maybeSingle<QuotationPdfSettingsRecord>();

  if (error) {
    logServerActionError("QUOTATION PDF SETTINGS LOAD ERROR", error, {
      action: "loadQuotationPdfSettings",
      recordId: quotationId,
      table: "quotation_pdfs",
    });
    return {
      success: false,
      status: 500,
      error: formatSafeActionError("Failed to load quotation PDF settings", error),
      details: supabaseErrorDetails(error) ?? error.message,
      code: error.code,
    };
  }

  return {
    success: true,
    hasStoredSettings: Boolean(data),
    settings: normalizeQuotationPdfSettings(data?.settings_json, {
      updatedAt: data?.updated_at ?? null,
    }),
  };
}

export async function saveQuotationPdfSettings(quotationId: string, settings: unknown): Promise<SaveResult> {
  const auth = await activeUser();
  if ("error" in auth) {
    return auth.details
      ? { success: false, status: auth.status, error: auth.error, details: auth.details, code: auth.code }
      : { success: false, status: auth.status, error: auth.error, code: auth.code };
  }

  if (!canManageRecords(auth.profile)) {
    return { success: false, status: 403, error: "Forbidden." };
  }

  const { data: quotation, error: quotationError } = await auth.supabase
    .from("quotations")
    .select("id")
    .eq("id", quotationId)
    .maybeSingle<QuotationRecord>();

  if (quotationError) {
    logServerActionError("QUOTATION PDF SETTINGS QUOTATION READ ERROR", quotationError, {
      action: "saveQuotationPdfSettings",
      recordId: quotationId,
      table: "quotations",
    });
    return {
      success: false,
      status: 500,
      error: formatSafeActionError("Failed to verify quotation", quotationError),
      details: supabaseErrorDetails(quotationError) ?? quotationError.message,
      code: quotationError.code,
    };
  }

  if (!quotation) {
    return { success: false, status: 404, error: "Quotation not found." };
  }

  const updatedAt = new Date().toISOString();
  const normalizedSettings = normalizeQuotationPdfSettings(settings, { updatedAt });
  const settingsToSave = {
    ...normalizedSettings,
    updatedAt,
  };

  const { data, error } = await auth.supabase
    .from("quotation_pdfs")
    .upsert(
      {
        quotation_id: quotationId,
        settings_json: settingsToSave,
      },
      { onConflict: "quotation_id" },
    )
    .select("settings_json,updated_at")
    .single<QuotationPdfSettingsRecord>();

  if (error) {
    logServerActionError("QUOTATION PDF SETTINGS SAVE ERROR", error, {
      action: "saveQuotationPdfSettings",
      recordId: quotationId,
      table: "quotation_pdfs",
      field: "settings_json",
    });
    return {
      success: false,
      status: 500,
      error: formatSafeActionError("Failed to save quotation PDF settings", error),
      details: supabaseErrorDetails(error) ?? error.message,
      code: error.code,
    };
  }

  return {
    success: true,
    settings: normalizeQuotationPdfSettings(data?.settings_json, {
      updatedAt: data?.updated_at ?? settingsToSave.updatedAt,
    }),
  };
}
