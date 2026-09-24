import "server-only";

import { requireActiveUser } from "@/lib/auth";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { createClient } from "@/lib/supabase/server";
import type { NoaCapabilityResult, NoaPageContext } from "./noa-types";

const MAX_PROJECT_ROWS = 20;
const MAX_PROJECT_ORDER_ROWS = 20;
const PROJECT_SELECT = "id,client_id,project_name,project_number,project_code,location,consultant,contractor,project_status,is_active,created_at";
const PROJECT_STATUSES = ["active", "on_hold", "completed", "cancelled"] as const;

type ProjectStatus = typeof PROJECT_STATUSES[number];
const PROJECT_STATUS_SET = new Set<ProjectStatus>(PROJECT_STATUSES);
type ProjectRow = {
  client_id: string;
  consultant: string | null;
  contractor: string | null;
  created_at: string;
  id: string;
  is_active: boolean;
  location: string | null;
  project_code: string | null;
  project_name: string;
  project_number: string | null;
  project_status: ProjectStatus;
};

type ClientRow = { company_name: string | null; id: string };
type QuotationLayoutRow = { layout_settings: unknown };

const UNAUTHORIZED_RESULT: NoaCapabilityResult = {
  message: "I couldn't access Project records for this account.",
  ok: false,
  reason: "unauthorized",
};

function isNextRedirectError(error: unknown) {
  return error instanceof Error && "digest" in error &&
    typeof (error as Error & { digest?: unknown }).digest === "string" &&
    (error as Error & { digest: string }).digest.startsWith("NEXT_REDIRECT");
}

function statusFromMessage(message: string): ProjectStatus | null {
  const normalized = message.toLowerCase();
  const status = /\bon hold\b/.test(normalized) ? "on_hold"
    : /\bcompleted\b/.test(normalized) ? "completed"
      : /\bcancelled\b/.test(normalized) ? "cancelled"
        : /\bactive\b/.test(normalized) ? "active"
          : null;
  if (status && PROJECT_STATUS_SET.has(status)) return status;
  return null;
}

function statusLabel(status: ProjectStatus) {
  return status === "on_hold" ? "On Hold" : `${status[0].toUpperCase()}${status.slice(1)}`;
}

function projectTarget(message: string) {
  const patterns = [
    /project details? for (.+)$/i,
    /project status for (.+)$/i,
    /status of project (.+)$/i,
    /(?:what|which) client is project (.+?) for$/i,
    /where is project (.+)$/i,
    // C4B: natural phrasing that names the project without the "X for"/"of project X" structure
    // the patterns above require.
    /tell me about (?:project )?(.+)$/i,
    /what status is (?:project )?(.+?)\??$/i,
  ];
  for (const pattern of patterns) {
    const target = message.match(pattern)?.[1]?.trim();
    if (target) return target;
  }
  return null;
}

function isDetailQuestion(message: string, context: NoaPageContext) {
  return Boolean(context.projectId) && /\b(this|current|status|client|where|details?)\b/i.test(message) ||
    /\b(project details?|project status|status of project|client is project|where is project|tell me about|status is)\b/i.test(message);
}

async function clientNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientIds: string[],
) {
  if (!clientIds.length) return new Map<string, string>();
  const { data } = await supabase
    .from("clients")
    .select("id,company_name")
    .in("id", [...new Set(clientIds)])
    .returns<ClientRow[]>();
  return new Map((data ?? []).map((client) => [client.id, client.company_name ?? "Unknown client"]));
}

function safeProjectRow(project: ProjectRow, clientName: string | null) {
  return {
    archiveState: project.is_active ? "listed" : "archived",
    client: clientName,
    consultant: project.consultant,
    contractor: project.contractor,
    createdAt: project.created_at,
    location: project.location,
    projectCode: project.project_code,
    projectName: project.project_name,
    projectNumber: project.project_number,
    projectStatus: project.project_status,
  };
}

async function projectRecordAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
  context: NoaPageContext,
): Promise<NoaCapabilityResult> {
  if (isDetailQuestion(message, context)) {
    let query = supabase.from("projects").select(PROJECT_SELECT);
    if (context.projectId) {
      query = query.eq("id", context.projectId);
    } else {
      const target = projectTarget(message);
      if (!target) return { message: "Please specify the Project name, number, or code.", ok: false, reason: "ambiguous" };
      const safeTarget = target.replace(/[%_,().]/g, " ").trim();
      query = query.or(`project_name.ilike.%${safeTarget}%,project_number.ilike.%${safeTarget}%,project_code.ilike.%${safeTarget}%`);
    }
    const { data: project } = await query.limit(1).maybeSingle<ProjectRow>();
    if (!project) return { message: "I couldn't find that Project record.", ok: false, reason: "not_found" };
    const names = await clientNames(supabase, [project.client_id]);
    const safeRow = safeProjectRow(project, names.get(project.client_id) ?? null);
    return {
      data: {
        kind: "project_record_detail",
        project: safeRow,
        deterministicText: `${project.project_name} is ${statusLabel(project.project_status)} and ${project.is_active ? "listed" : "archived"}.`,
      },
      ok: true,
      sources: [{ label: "Project · Checked project record", type: "project_record" }],
    };
  }

  const normalized = message.toLowerCase();
  const archived = /\barchived\b/.test(normalized);
  const requestedStatus = statusFromMessage(message);
  const countOnly = /\b(how many|count|number of)\b/.test(normalized);
  let query = supabase
    .from("projects")
    .select(PROJECT_SELECT, { count: "exact" })
    .eq("is_active", !archived)
    .order("created_at", { ascending: false });
  if (requestedStatus) query = query.eq("project_status", requestedStatus);
  const { count, data } = await query.limit(MAX_PROJECT_ROWS).returns<ProjectRow[]>();
  const projects = data ?? [];
  const totalMatching = count ?? projects.length;
  const names = countOnly ? new Map<string, string>() : await clientNames(supabase, projects.map((project) => project.client_id));
  const rows = countOnly ? [] : projects.map((project) => safeProjectRow(project, names.get(project.client_id) ?? null));
  const description = archived ? "archived" : requestedStatus ? statusLabel(requestedStatus).toLowerCase() : "listed";
  return {
    data: {
      kind: countOnly ? "project_record_count" : "project_record_list",
      returnedCount: rows.length,
      rows,
      totalMatching,
      truncatedCount: Math.max(0, totalMatching - rows.length),
      deterministicText: `I found ${totalMatching} ${description} Project record${totalMatching === 1 ? "" : "s"}.${countOnly ? "" : ` Showing ${rows.length}.`}`,
    },
    ok: true,
    sources: [{ label: "Project · Checked project records", type: "project_record" }],
  };
}

async function projectOrderAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const normalized = message.toLowerCase();
  const completed = /\bcompleted\b/.test(normalized);
  const countOnly = /\b(how many|count|number of)\b/.test(normalized);
  const { data } = await supabase
    .from("quotations")
    .select("layout_settings")
    .returns<QuotationLayoutRow[]>();
  const orders = (data ?? [])
    .flatMap((quotation) => {
      const settings = quotation.layout_settings as Record<string, unknown> | null;
      const completedAt = typeof settings?.projectCompletedAt === "string" ? settings.projectCompletedAt : null;
      const cancelledAt = typeof settings?.projectCancelledAt === "string" ? settings.projectCancelledAt : null;
      if (completed ? !completedAt : completedAt || cancelledAt) return [];
      const order = projectFileFromLayoutSettings(quotation.layout_settings) ??
        clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder;
      return order ? [{
        clientName: order.clientName,
        completedAt,
        createdAt: order.createdAt,
        currency: order.currency,
        orderNo: order.orderNo,
        reference: order.reference,
        total: order.total,
      }] : [];
    })
    .filter((order, index, all) => all.findIndex((candidate) => candidate.orderNo === order.orderNo) === index)
    .sort((a, b) => new Date(completed ? b.completedAt! : b.createdAt).getTime() - new Date(completed ? a.completedAt! : a.createdAt).getTime());
  const rows = countOnly ? [] : orders.slice(0, MAX_PROJECT_ORDER_ROWS);
  const label = completed ? "completed" : "active";
  return {
    data: {
      kind: countOnly ? "project_order_count" : "project_order_list",
      returnedCount: rows.length,
      rows,
      totalMatching: orders.length,
      truncatedCount: Math.max(0, orders.length - rows.length),
      deterministicText: `I found ${orders.length} ${label} Project order${orders.length === 1 ? "" : "s"}.${countOnly ? "" : ` Showing ${rows.length}.`}`,
    },
    ok: true,
    sources: [{ label: "Project · Checked project orders", type: "project_order" }],
  };
}

export async function fetchNoaProjectCapability(
  message: string,
  context: NoaPageContext,
): Promise<NoaCapabilityResult> {
  try {
    await requireActiveUser();
  } catch (error) {
    if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
    throw error;
  }

  const supabase = await createClient();
  return /\bproject orders?\b/i.test(message)
    ? projectOrderAnswer(supabase, message)
    : projectRecordAnswer(supabase, message, context);
}
