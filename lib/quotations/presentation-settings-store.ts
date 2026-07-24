import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { normalizePresentationSettings } from "@/lib/quotations/presentation-settings";

type ProfileRecord = {
  role: string | null;
  account_status: string | null;
};

type QuotationRecord = {
  id: string;
};

type PresentationSettingsRecord = {
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

type AuthSuccess = {
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>;
  user: { id: string };
};

type SaveResult =
  | { success: true; settings: ReturnType<typeof normalizePresentationSettings> }
  | { success: false; status: number; error: string; details?: string; code?: string };

type LoadResult =
  | { success: true; settings: ReturnType<typeof normalizePresentationSettings> }
  | { success: false; status: number; error: string; details?: string; code?: string };

function supabaseErrorDetails(error: SupabaseLikeError | null | undefined) {
  if (!error) return null;

  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" | ") || null;
}

async function activeRecordsManager(): Promise<AuthFailure | AuthSuccess> {
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
    logServerActionError("PRESENTATION SETTINGS PROFILE ERROR", profileError, {
      action: "loadPresentationSettings.activeRecordsManager",
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

  if (
    profile?.account_status !== "active" ||
    !["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator"].includes(profile?.role ?? "")
  ) {
    return { supabase, error: "Forbidden.", status: 403 } satisfies AuthFailure;
  }

  return { supabase, user: { id: user.id } } satisfies AuthSuccess;
}

export async function loadPresentationSettings(quotationId: string): Promise<LoadResult> {
  const auth = await activeRecordsManager();
  if ("error" in auth) {
    return auth.details
      ? { success: false, status: auth.status, error: auth.error, details: auth.details, code: auth.code }
      : { success: false, status: auth.status, error: auth.error, code: auth.code };
  }

  const { data, error } = await auth.supabase
    .from("quotation_presentations")
    .select("settings_json,updated_at")
    .eq("quotation_id", quotationId)
    .maybeSingle<PresentationSettingsRecord>();

  if (error) {
    logServerActionError("PRESENTATION SETTINGS LOAD ERROR", error, {
      action: "loadPresentationSettings",
      recordId: quotationId,
      table: "quotation_presentations",
    });
    return {
      success: false,
      status: 500,
      error: formatSafeActionError("Failed to load presentation settings", error),
      details: supabaseErrorDetails(error) ?? error.message,
      code: error.code,
    };
  }

  return {
    success: true,
    settings: normalizePresentationSettings(data?.settings_json, {
      updatedAt: data?.updated_at ?? null,
    }),
  };
}

export async function savePresentationSettings(quotationId: string, settings: unknown): Promise<SaveResult> {
  const auth = await activeRecordsManager();
  if ("error" in auth) {
    return auth.details
      ? { success: false, status: auth.status, error: auth.error, details: auth.details, code: auth.code }
      : { success: false, status: auth.status, error: auth.error, code: auth.code };
  }

  const { data: quotation, error: quotationError } = await auth.supabase
    .from("quotations")
    .select("id")
    .eq("id", quotationId)
    .maybeSingle<QuotationRecord>();

  if (quotationError) {
    logServerActionError("PRESENTATION SETTINGS QUOTATION READ ERROR", quotationError, {
      action: "savePresentationSettings",
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
  const normalizedSettings = normalizePresentationSettings(settings, { updatedAt });
  const settingsToSave = {
    ...normalizedSettings,
    updatedAt,
  };

  const { data, error } = await auth.supabase
    .from("quotation_presentations")
    .upsert(
      {
        quotation_id: quotationId,
        settings_json: settingsToSave,
      },
      { onConflict: "quotation_id" },
    )
    .select("settings_json,updated_at")
    .single<PresentationSettingsRecord>();

  if (error) {
    logServerActionError("PRESENTATION SETTINGS SAVE ERROR", error, {
      action: "savePresentationSettings",
      recordId: quotationId,
      table: "quotation_presentations",
      field: "settings_json",
    });
    return {
      success: false,
      status: 500,
      error: formatSafeActionError("Failed to save presentation settings", error),
      details: supabaseErrorDetails(error) ?? error.message,
      code: error.code,
    };
  }

  return {
    success: true,
    settings: normalizePresentationSettings(data?.settings_json, {
      updatedAt: data?.updated_at ?? settingsToSave.updatedAt,
    }),
  };
}
