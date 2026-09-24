import "server-only";

import { requireActiveUser } from "@/lib/auth";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { createClient } from "@/lib/supabase/server";
import type { NoaSemanticEntity } from "./noa-semantic-request";
import type { NoaCapabilityResult, NoaPageContext } from "./noa-types";

const MAX_CLIENT_ROWS = 20;
const MAX_CLIENT_PROJECT_ROWS = 10;
// ERP-NOA-2: bounded scan of this client's own quotations only (never unbounded), matching the
// same "bounded candidate rows" principle Project's own PROJECT_FILE_SCAN_LIMIT uses.
const CLIENT_PROJECT_FILE_SCAN_LIMIT = 200;
// ERP-NOA-2 (PART 4): explicit wording required to reach the older standalone `projects` table
// for a client's projects - generic "projects" now means ERP Project Files (PART 1).
const CLIENT_PROJECT_RECORD_PATTERN = /\bproject records?\b/i;

// Identity/lifecycle fields only - PART 5/12: contact fields that DO exist on this table
// (contact_person, email, phone, website, address, city, country, trn, notes - confirmed via
// app/clients/page.tsx's own select) are deliberately excluded from every B4 payload. No B4
// question asks for a specific contact detail, so the safest, simplest rule is "never select
// them here at all" rather than building a "did the user explicitly ask for this field" detector.
const CLIENT_SELECT = "id,company_name,client_number,client_code,is_active";

// PART 6: a narrower field set than Project's own capability exposes for itself - name/code/
// status/archive-state only, no location/consultant/contractor, per this task's explicit scope.
const CLIENT_PROJECT_SELECT = "id,project_name,project_number,project_code,project_status,is_active";

type ClientRow = {
  client_code: string | null;
  client_number: string | null;
  company_name: string;
  id: string;
  is_active: boolean;
};

type ClientProjectRow = {
  id: string;
  is_active: boolean;
  project_code: string | null;
  project_name: string;
  project_number: string | null;
  project_status: string | null;
};

const UNAUTHORIZED_RESULT: NoaCapabilityResult = {
  message: "I couldn't access client records for this account.",
  ok: false,
  reason: "unauthorized",
};

function isNextRedirectError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
  );
}

type ClientQuestionKind = "count" | "detail" | "list" | "projects";
type NoaClientCapabilityOptions = { entity?: NoaSemanticEntity & { type: "client" } };

// PART 3: deterministic classification only (no LLM), mirroring productQuestionKind()/
// quotationQuestionKind()/the Project capability's own question detection.
function clientQuestionKind(message: string): ClientQuestionKind {
  const normalized = message.toLowerCase();
  // Checked first: "how many projects does client X have" must win over the generic "how many"
  // count check below (it asks about the client's Projects, not a count of Client records).
  // C4C: "what projects does Apex have" (no literal "client" word) is recognized the same way.
  if (/\bprojects?\b/.test(normalized) && (/\bclient\b/.test(normalized) || /\b(?:do|does) .+ have\b/.test(normalized))) return "projects";
  // C4C: "tell me about client Apex" / "show client Apex" added alongside the existing phrases.
  if (/\bclient details?\b|\bdetails? for (?:the )?client\b|\bclient info(?:rmation)?\b|\btell me about client\b|\bshow client\b/.test(normalized)) return "detail";
  if (/\b(how many|count|number of)\b/.test(normalized)) return "count";
  return "list";
}

function clientTarget(message: string): string | null {
  const patterns = [
    /client details? for (.+)$/i,
    /details? for (?:the )?client (.+)$/i,
    /client info(?:rmation)? for (.+)$/i,
    /projects? for client (.+)$/i,
    /how many projects (?:does |for )?client (.+?)(?: have)?$/i,
    // C4C: natural phrasing without the "X for"/"for client X" structure above. ERP-NOA-2: the
    // optional "records? " consumption lets the SAME pattern correctly extract "Apex" from both
    // "what projects does Apex have" (ERP default) and "what project records does Apex have"
    // (explicit standalone path).
    /(?:tell me about|show) client (.+)$/i,
    /projects?(?: records?)? (?:do|does) (?:client )?(.+?) have\b/i,
  ];
  for (const pattern of patterns) {
    const target = message.match(pattern)?.[1]?.trim();
    if (target) return target;
  }
  return null;
}

function archiveState(client: Pick<ClientRow, "is_active">) {
  return client.is_active ? "active" : "archived";
}

function safeClientRow(client: ClientRow) {
  return {
    archiveState: archiveState(client),
    clientCode: client.client_code,
    clientNumber: client.client_number,
    id: client.id,
    name: client.company_name,
  };
}

function safeClientProjectRow(project: ClientProjectRow) {
  return {
    archiveState: project.is_active ? "listed" : "archived",
    projectCode: project.project_code,
    projectName: project.project_name,
    projectNumber: project.project_number,
    projectStatus: project.project_status,
  };
}

async function findClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  target: string,
): Promise<ClientRow | null> {
  const safeTarget = target.replace(/[%_,().?!]/g, " ").trim();
  if (!safeTarget) return null;
  const { data } = await supabase
    .from("clients")
    .select(CLIENT_SELECT)
    .or(`company_name.ilike.%${safeTarget}%,client_number.ilike.%${safeTarget}%,client_code.ilike.%${safeTarget}%`)
    .limit(1)
    .maybeSingle<ClientRow>();
  return data ?? null;
}

async function resolveClientEntity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  candidate: string,
): Promise<ClientRow | NoaCapabilityResult> {
  const normalized = candidate.trim().toLowerCase();
  const safeCandidate = candidate.replace(/[%_,().?!]/g, " ").trim();
  if (!safeCandidate) return { message: `I couldn't find a matching client for "${candidate}".`, ok: false, reason: "not_found" };
  const { data } = await supabase
    .from("clients")
    .select(CLIENT_SELECT)
    .ilike("company_name", `%${safeCandidate}%`)
    .limit(3)
    .returns<ClientRow[]>();
  const rows = data ?? [];
  const exact = rows.filter((client) => client.company_name.trim().toLowerCase() === normalized);
  const matches = exact.length > 0 ? exact : rows;
  if (matches.length === 0) return { message: `I couldn't find a matching client for "${candidate}".`, ok: false, reason: "not_found" };
  if (matches.length > 1) return { message: `I found more than one client matching "${candidate}". Please be more specific.`, ok: false, reason: "ambiguous" };
  return matches[0];
}

// ERP-NOA-3 (PART 1): the detail summary's inline project count now uses the SAME bounded ERP
// Project File source (clientProjectFiles(), below) that clientProjectFilesAnswer() already
// established in ERP-NOA-2 - never a second parsing/query architecture. Quotation count is
// untouched (still a direct, unrelated count query against `quotations`).
async function clientDetailAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  client: ClientRow,
): Promise<NoaCapabilityResult> {
  const [projectFiles, { count: quotationCount }] = await Promise.all([
    clientProjectFiles(supabase, client.id),
    supabase.from("quotations").select("id", { count: "exact", head: true }).eq("client_id", client.id),
  ]);
  const projects = projectFiles.length;
  const quotations = quotationCount ?? 0;

  return {
    data: {
      client: safeClientRow(client),
      kind: "client_record_detail",
      projectCount: projects,
      quotationCount: quotations,
      deterministicText: `${client.company_name} is ${archiveState(client)}, with ${projects} Project File${projects === 1 ? "" : "s"} and ${quotations} quotation${quotations === 1 ? "" : "s"}.`,
    },
    ok: true,
    sources: [{ label: "Client · Checked client record", type: "client_record" }],
  };
}

// PART 6: Client-specific bounded read of projects.client_id - never a call into the Project
// capability (no cross-capability chaining), auth already passed for this request.
async function clientProjectsAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  client: ClientRow,
  countOnly: boolean,
): Promise<NoaCapabilityResult> {
  const { count, data } = await supabase
    .from("projects")
    .select(CLIENT_PROJECT_SELECT, { count: "exact" })
    .eq("client_id", client.id)
    .order("project_name", { ascending: true })
    .limit(MAX_CLIENT_PROJECT_ROWS)
    .returns<ClientProjectRow[]>();
  const totalMatching = count ?? 0;
  const rows = countOnly ? [] : (data ?? []).map(safeClientProjectRow);

  return {
    data: {
      client: safeClientRow(client),
      kind: countOnly ? "client_project_count" : "client_project_list",
      returnedCount: rows.length,
      rows,
      totalMatching,
      truncatedCount: Math.max(0, totalMatching - rows.length),
      deterministicText: `${client.company_name} has ${totalMatching} project${totalMatching === 1 ? "" : "s"}.${countOnly ? "" : ` Showing ${rows.length}.`}`,
    },
    ok: true,
    sources: [{ label: "Client · Checked related projects", recordId: client.id, type: "client_project" }],
  };
}

type ClientProjectFileStatus = "active" | "completed" | "cancelled";

function safeClientProjectFileRow(order: {
  clientName: string;
  currency: string;
  orderNo: string;
  reference: string;
  status: ClientProjectFileStatus;
  total: number;
}) {
  return {
    clientName: order.clientName,
    currency: order.currency,
    orderNo: order.orderNo,
    reference: order.reference,
    status: order.status,
    total: order.total,
  };
}

// ERP-NOA-2/3: the single bounded ERP Project File scan for one client - matches quotations by
// the authoritative `client_id` FK (bounded, server-side, never an unbounded scan), then reuses
// the SAME existing union every other current caller (Project capability, Procurement capability,
// the Active Project Files page) uses to resolve each quotation's confirmed Project File - never a
// new parser. Reused by BOTH clientProjectFilesAnswer() (below) and clientDetailAnswer()'s inline
// count (ERP-NOA-3 PART 1), so there is only ever one parsing/query path for this relationship.
async function clientProjectFiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
): Promise<Array<{ clientName: string; currency: string; orderNo: string; reference: string; status: ClientProjectFileStatus; total: number }>> {
  const { data } = await supabase
    .from("quotations")
    .select("layout_settings")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(CLIENT_PROJECT_FILE_SCAN_LIMIT)
    .returns<Array<{ layout_settings: unknown }>>();

  return (data ?? [])
    .flatMap((quotation) => {
      const order = projectFileFromLayoutSettings(quotation.layout_settings) ??
        clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder;
      if (!order) return [];
      const settings = quotation.layout_settings as Record<string, unknown> | null;
      const completedAt = typeof settings?.projectCompletedAt === "string" ? settings.projectCompletedAt : null;
      const cancelledAt = typeof settings?.projectCancelledAt === "string" ? settings.projectCancelledAt : null;
      const status: ClientProjectFileStatus = cancelledAt ? "cancelled" : completedAt ? "completed" : "active";
      return [{ clientName: order.clientName, currency: order.currency, orderNo: order.orderNo, reference: order.reference, status, total: order.total }];
    })
    .filter((order, index, all) => all.findIndex((candidate) => candidate.orderNo === order.orderNo) === index);
}

async function clientProjectFilesAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  client: ClientRow,
  countOnly: boolean,
): Promise<NoaCapabilityResult> {
  const orders = await clientProjectFiles(supabase, client.id);
  const totalMatching = orders.length;
  const rows = countOnly ? [] : orders.slice(0, MAX_CLIENT_PROJECT_ROWS).map(safeClientProjectFileRow);

  return {
    data: {
      client: safeClientRow(client),
      kind: countOnly ? "client_project_file_count" : "client_project_file_list",
      returnedCount: rows.length,
      rows,
      totalMatching,
      truncatedCount: Math.max(0, totalMatching - rows.length),
      deterministicText: `${client.company_name} has ${totalMatching} Project File${totalMatching === 1 ? "" : "s"}.${countOnly ? "" : ` Showing ${rows.length}.`}`,
    },
    ok: true,
    sources: [{ label: "Client · Checked related Project Files", type: "client_project_file" }],
  };
}

async function clientListAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
  countOnly: boolean,
): Promise<NoaCapabilityResult> {
  const archived = /\barchived\b/.test(message.toLowerCase());
  const { count, data } = await supabase
    .from("clients")
    .select(CLIENT_SELECT, { count: "exact" })
    .eq("is_active", !archived)
    .order("company_name", { ascending: true })
    .limit(MAX_CLIENT_ROWS)
    .returns<ClientRow[]>();
  const totalMatching = count ?? 0;
  const rows = countOnly ? [] : (data ?? []).map(safeClientRow);
  const description = archived ? "archived" : "active";

  return {
    data: {
      kind: countOnly ? "client_count" : "client_list",
      returnedCount: rows.length,
      rows,
      totalMatching,
      truncatedCount: Math.max(0, totalMatching - rows.length),
      deterministicText: `I found ${totalMatching} ${description} client${totalMatching === 1 ? "" : "s"}.${countOnly ? "" : ` Showing ${rows.length}.`}`,
    },
    ok: true,
    sources: [{ label: "Client · Checked client records", type: "client_record" }],
  };
}

// PART 2: the single entry point every Client question dispatches through - deterministic
// classification, its own independent requireActiveUser() gate, user-scoped Supabase reads only,
// the existing NoaCapabilityResult contract. No writes anywhere in this file.
export async function fetchNoaClientCapability(
  message: string,
  _context: NoaPageContext,
  options: NoaClientCapabilityOptions = {},
): Promise<NoaCapabilityResult> {
  try {
    await requireActiveUser();
  } catch (error) {
    if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
    throw error;
  }

  const supabase = await createClient();
  const kind = clientQuestionKind(message);

  if (options.entity) {
    const resolved = await resolveClientEntity(supabase, options.entity.text);
    if ("ok" in resolved) return resolved;
    if (kind === "projects") {
      const countOnly = /\b(how many|count|number of)\b/.test(message.toLowerCase());
      return CLIENT_PROJECT_RECORD_PATTERN.test(message)
        ? clientProjectsAnswer(supabase, resolved, countOnly)
        : clientProjectFilesAnswer(supabase, resolved, countOnly);
    }
    return clientDetailAnswer(supabase, resolved);
  }

  if (kind === "detail" || kind === "projects") {
    const target = clientTarget(message);
    if (!target) {
      return { message: "Please specify the client name or number.", ok: false, reason: "ambiguous" };
    }

    const client = await findClient(supabase, target);
    if (!client) {
      return { message: "I couldn't find that client record.", ok: false, reason: "not_found" };
    }

    if (kind === "projects") {
      const countOnly = /\b(how many|count|number of)\b/.test(message.toLowerCase());
      // ERP-NOA-2 (PART 1/4): generic "projects" now means ERP Project Files by default; explicit
      // "project record(s)" wording is the only way back to the standalone `projects` table.
      return CLIENT_PROJECT_RECORD_PATTERN.test(message)
        ? clientProjectsAnswer(supabase, client, countOnly)
        : clientProjectFilesAnswer(supabase, client, countOnly);
    }

    return clientDetailAnswer(supabase, client);
  }

  return clientListAnswer(supabase, message, kind === "count");
}
