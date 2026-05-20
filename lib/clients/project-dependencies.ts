import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

function safeSupabaseErrorReason(error: { code?: string | null; message?: string | null; details?: string | null }) {
  const detail = [error.code, error.message, error.details].filter(Boolean).join(" - ");
  return detail || "unknown server error";
}

export async function loadProjectQuotationDependencyCount(projectId: string) {
  const adminClientResult = createAdminClient();

  if (adminClientResult.error || !adminClientResult.client) {
    return {
      count: null,
      error: adminClientResult.error ?? "Server admin delete is not configured.",
    };
  }

  try {
    const { count, error } = await adminClientResult.client
      .from("quotations")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);

    if (error) {
      console.error("PROJECT DEPENDENCY CHECK QUOTATIONS ERROR", {
        check: "quotations",
        code: error.code ?? null,
        message: error.message ?? null,
        details: error.details ?? null,
        projectId,
      });

      return {
        count: null,
        error: `Project dependencies could not be checked in quotations: ${safeSupabaseErrorReason(error)}`,
      };
    }

    return {
      count: count ?? 0,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown server error";

    console.error("PROJECT DEPENDENCY CHECK QUOTATIONS EXCEPTION", {
      check: "quotations",
      message,
      projectId,
    });

    return {
      count: null,
      error: `Project dependencies could not be checked in quotations: ${message}`,
    };
  }
}

export async function loadProjectQuotationDependencyCounts(projectIds: string[]) {
  const countsByProjectId = new Map<string, number>();

  if (!projectIds.length) {
    return {
      countsByProjectId,
      error: null,
    };
  }

  const adminClientResult = createAdminClient();

  if (adminClientResult.error || !adminClientResult.client) {
    return {
      countsByProjectId,
      error: adminClientResult.error ?? "Server admin delete is not configured.",
    };
  }

  try {
    const { data, error } = await adminClientResult.client
      .from("quotations")
      .select("project_id")
      .in("project_id", projectIds)
      .returns<Array<{ project_id: string }>>();

    if (error) {
      console.error("ARCHIVE PROJECT DEPENDENCY CHECK QUOTATIONS ERROR", {
        check: "quotations",
        code: error.code ?? null,
        message: error.message ?? null,
        details: error.details ?? null,
        projectIds,
      });

      return {
        countsByProjectId,
        error: `Project dependencies could not be checked in quotations: ${safeSupabaseErrorReason(error)}`,
      };
    }

    for (const row of data ?? []) {
      countsByProjectId.set(row.project_id, (countsByProjectId.get(row.project_id) ?? 0) + 1);
    }

    return {
      countsByProjectId,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown server error";

    console.error("ARCHIVE PROJECT DEPENDENCY CHECK QUOTATIONS EXCEPTION", {
      check: "quotations",
      message,
      projectIds,
    });

    return {
      countsByProjectId,
      error: `Project dependencies could not be checked in quotations: ${message}`,
    };
  }
}
