import "server-only";

import { requireActiveUser } from "@/lib/auth";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { createClient } from "@/lib/supabase/server";
import type { NoaSemanticEntity } from "./noa-semantic-request";
import type { NoaCapabilityResult, NoaPageContext } from "./noa-types";

const MAX_PROJECT_ROWS = 20;
const MAX_PROJECT_ORDER_ROWS = 20;
// ERP-NOA-1: a bounded cap on how many quotations are ever scanned to build the ERP Project File
// candidate set - mirrors the same "bounded candidate rows, never unbounded history" principle
// Price's own broad scan already uses (BROAD_SCAN_LIMIT).
const PROJECT_FILE_SCAN_LIMIT = 200;
const PROJECT_SELECT = "id,client_id,project_name,project_number,project_code,location,consultant,contractor,project_status,is_active,created_at";
const PROJECT_STATUSES = ["active", "on_hold", "completed", "cancelled"] as const;
const PROJECT_FILE_IDENTIFIER_PATTERN = /\bCO-\d{3,}(?:-\d+)*\b/gi;
// ERP-NOA-1: generic "project" wording now means the ERP Project File by default (PART 1); this
// pattern is the ONLY way to reach the older standalone `projects` table explicitly (PART 2).
const PROJECT_RECORD_PATTERN = /\b(?:standalone )?project records?\b/i;

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
  const identifiers = [...message.matchAll(PROJECT_FILE_IDENTIFIER_PATTERN)].map((match) => match[0]);
  if (identifiers.length === 1) return identifiers[0];

  const patterns = [
    /project details? for (.+)$/i,
    /project status for (.+)$/i,
    /status of project (.+)$/i,
    /(?:what|which) client is project (.+?) for$/i,
    /where is project (.+)$/i,
    // C4B: natural phrasing that names the project without the "X for"/"of project X" structure
    // the patterns above require. ERP-NOA-1: the optional "record(s) " consumption lets the SAME
    // pattern correctly strip "project record ABC" -> "ABC" for the explicit standalone path,
    // while still capturing the full ERP-path target ("CO-0003-001"/"Galleria Mall ...") when no
    // "project"/"record" wording is present at all.
    /tell me about (?:project (?:records?\s+)?)?(.+)$/i,
    /what status is (?:project (?:records?\s+)?)?(.+?)\??$/i,
  ];
  for (const pattern of patterns) {
    const target = message.match(pattern)?.[1]?.trim();
    if (target) return target;
  }
  return null;
}

export function projectFileIdentifierCount(message: string): number {
  return [...message.matchAll(PROJECT_FILE_IDENTIFIER_PATTERN)].length;
}

function isDetailQuestion(message: string, context: NoaPageContext) {
  return Boolean(context.projectId) && /\b(this|current|status|client|where|details?)\b/i.test(message) ||
    projectFileIdentifierCount(message) > 0 ||
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

type ProjectFileStatus = "active" | "completed" | "cancelled";

type ProjectFileSummary = {
  clientName: string;
  completedAt: string | null;
  createdAt: string;
  currency: string;
  orderNo: string;
  reference: string;
  status: ProjectFileStatus;
  total: number;
};

type NoaProjectCapabilityOptions = {
  entity?: NoaSemanticEntity & { type: "project_file" };
};

export type NoaEntityCandidateResolution =
  | { domain: "Project"; entity: NoaSemanticEntity & { type: "project_file" } }
  | { domain: "Client"; entity: NoaSemanticEntity & { type: "client" } }
  | { domain: "ambiguous" }
  | { domain: "not_found" };

function safeProjectFileRow(order: ProjectFileSummary) {
  return {
    clientName: order.clientName,
    currency: order.currency,
    orderNo: order.orderNo,
    reference: order.reference,
    status: order.status,
    total: order.total,
  };
}

function projectFileEntityResult(orders: ProjectFileSummary[], candidate: string): NoaCapabilityResult {
  const normalizedCandidate = candidate.trim().toLowerCase();
  const exact = orders.filter((order) =>
    order.orderNo.toLowerCase() === normalizedCandidate || order.reference.toLowerCase() === normalizedCandidate);
  const matches = exact.length > 0
    ? exact
    : orders.filter((order) => order.reference.toLowerCase().includes(normalizedCandidate));
  if (matches.length === 0) return { message: `I couldn't find a matching Project File for "${candidate}".`, ok: false, reason: "not_found" };
  if (matches.length > 1) return { message: `I found more than one Project File matching "${candidate}". Please be more specific.`, ok: false, reason: "ambiguous" };
  const match = matches[0];
  return {
    data: {
      kind: "project_file_detail",
      projectFile: safeProjectFileRow(match),
      deterministicText: `${match.orderNo} (${match.reference}) for ${match.clientName} is ${match.status}.`,
    },
    ok: true,
    sources: [{ label: "Project · Checked Project File", type: "project_file" }],
  };
}

function projectFileEntityMatches(orders: ProjectFileSummary[], candidate: string): ProjectFileSummary[] {
  const normalizedCandidate = candidate.trim().toLowerCase();
  const exact = orders.filter((order) => order.orderNo.toLowerCase() === normalizedCandidate || order.reference.toLowerCase() === normalizedCandidate);
  return exact.length > 0 ? exact : orders.filter((order) => order.reference.toLowerCase().includes(normalizedCandidate));
}

export async function resolveNoaEntityCandidate(candidate: string): Promise<NoaEntityCandidateResolution> {
  await requireActiveUser();
  const supabase = await createClient();
  const [orders, clientResult] = await Promise.all([
    allProjectFiles(supabase),
    supabase.from("clients").select("company_name").ilike("company_name", `%${candidate.replace(/[%_,().?!]/g, " ").trim()}%`).limit(3).returns<Array<{ company_name: string }>>(),
  ]);
  const normalized = candidate.trim().toLowerCase();
  const projectMatches = projectFileEntityMatches(orders, candidate);
  const clientRows = clientResult.data ?? [];
  const exactClients = clientRows.filter((client) => client.company_name.trim().toLowerCase() === normalized);
  const clientMatches = exactClients.length > 0 ? exactClients : clientRows;
  if (projectMatches.length === 1 && clientMatches.length === 0) return { domain: "Project", entity: { type: "project_file", text: projectMatches[0].orderNo } };
  if (projectMatches.length === 0 && clientMatches.length === 1) return { domain: "Client", entity: { type: "client", text: clientMatches[0].company_name } };
  if (projectMatches.length > 0 || clientMatches.length > 0) return { domain: "ambiguous" };
  return { domain: "not_found" };
}

// ERP-NOA-1 (PART 1/3): the single authoritative source for every ERP Project File - reuses the
// SAME union every other current caller (Active Project Files page, Procurement capability) uses,
// never a new parser. Bounded to PROJECT_FILE_SCAN_LIMIT most-recent quotations, never an
// unbounded scan. Cancelled orders are still returned here (a detail lookup may legitimately ask
// about one) but are excluded from both the active and completed LIST views below, exactly like
// the original behavior.
async function allProjectFiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ProjectFileSummary[]> {
  const { data } = await supabase
    .from("quotations")
    .select("layout_settings")
    .order("created_at", { ascending: false })
    .limit(PROJECT_FILE_SCAN_LIMIT)
    .returns<QuotationLayoutRow[]>();

  return (data ?? [])
    .flatMap((quotation) => {
      const settings = quotation.layout_settings as Record<string, unknown> | null;
      const completedAt = typeof settings?.projectCompletedAt === "string" ? settings.projectCompletedAt : null;
      const cancelledAt = typeof settings?.projectCancelledAt === "string" ? settings.projectCancelledAt : null;
      const order = projectFileFromLayoutSettings(quotation.layout_settings) ??
        clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder;
      if (!order) return [];
      const status: ProjectFileStatus = cancelledAt ? "cancelled" : completedAt ? "completed" : "active";
      return [{
        clientName: order.clientName,
        completedAt,
        createdAt: order.createdAt,
        currency: order.currency,
        orderNo: order.orderNo,
        reference: order.reference,
        status,
        total: order.total,
      }];
    })
    .filter((order, index, all) => all.findIndex((candidate) => candidate.orderNo === order.orderNo) === index);
}

// ERP-NOA-1 (PART 1/3/4/5): the new default "project" path. Detail lookup reuses the SAME
// isDetailQuestion()/projectTarget() text classification the standalone path already uses (no new
// parser), matching against orderNo, reference, and clientName (PART 3: client name only as a
// fallback match on the already-extracted target, no new phrase pattern invented). List/count
// preserves the exact active/completed/cancelled rules from before (PART 4) - cancelled orders
// are still excluded from both lists, unchanged.
async function projectFileAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
  context: NoaPageContext,
): Promise<NoaCapabilityResult> {
  const allOrders = await allProjectFiles(supabase);

  if (isDetailQuestion(message, context)) {
    const target = projectTarget(message);
    if (!target) return { message: "Please specify the Project File number or reference.", ok: false, reason: "ambiguous" };
    const normalizedTarget = target.trim().toLowerCase();
    const exactOrderMatch = allOrders.find((order) => order.orderNo.toLowerCase() === normalizedTarget);
    const match = exactOrderMatch ?? allOrders.find((order) =>
      order.orderNo.toLowerCase().includes(normalizedTarget) ||
      order.reference.toLowerCase().includes(normalizedTarget) ||
      order.clientName.toLowerCase().includes(normalizedTarget));
    if (!match) return { message: "I couldn't find that Project File.", ok: false, reason: "not_found" };
    return {
      data: {
        kind: "project_file_detail",
        projectFile: safeProjectFileRow(match),
        deterministicText: `${match.orderNo} (${match.reference}) for ${match.clientName} is ${match.status}.`,
      },
      ok: true,
      sources: [{ label: "Project · Checked Project File", type: "project_file" }],
    };
  }

  const normalized = message.toLowerCase();
  const completed = /\bcompleted\b/.test(normalized);
  const countOnly = /\b(how many|count|number of)\b/.test(normalized);
  const requestedStatus: ProjectFileStatus = completed ? "completed" : "active";
  const filtered = allOrders
    .filter((order) => order.status === requestedStatus)
    .sort((a, b) => new Date(completed ? (b.completedAt ?? b.createdAt) : b.createdAt).getTime()
      - new Date(completed ? (a.completedAt ?? a.createdAt) : a.createdAt).getTime());
  const rows = countOnly ? [] : filtered.slice(0, MAX_PROJECT_ORDER_ROWS).map(safeProjectFileRow);
  const label = completed ? "completed" : "active";
  return {
    data: {
      kind: countOnly ? "project_order_count" : "project_order_list",
      returnedCount: rows.length,
      rows,
      totalMatching: filtered.length,
      truncatedCount: Math.max(0, filtered.length - rows.length),
      deterministicText: `I found ${filtered.length} ${label} Project File${filtered.length === 1 ? "" : "s"}.${countOnly ? "" : ` Showing ${rows.length}.`}`,
    },
    ok: true,
    sources: [{ label: "Project · Checked Project Files", type: "project_file" }],
  };
}

export async function fetchNoaProjectCapability(
  message: string,
  context: NoaPageContext,
  options: NoaProjectCapabilityOptions = {},
): Promise<NoaCapabilityResult> {
  try {
    await requireActiveUser();
  } catch (error) {
    if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
    throw error;
  }

  const supabase = await createClient();
  if (options.entity) {
    return projectFileEntityResult(await allProjectFiles(supabase), options.entity.text);
  }
  // ERP-NOA-1 (PART 1/2): the ERP Project File is now the default "project" concept; the
  // standalone `projects` table is reached only via explicit "project record(s)" wording.
  return PROJECT_RECORD_PATTERN.test(message) && projectFileIdentifierCount(message) === 0
    ? projectRecordAnswer(supabase, message, context)
    : projectFileAnswer(supabase, message, context);
}
