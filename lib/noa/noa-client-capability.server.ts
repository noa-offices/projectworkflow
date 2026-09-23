import "server-only";

import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { NoaCapabilityResult, NoaPageContext } from "./noa-types";

const MAX_CLIENT_ROWS = 20;
const MAX_CLIENT_PROJECT_ROWS = 10;

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

// PART 3: deterministic classification only (no LLM), mirroring productQuestionKind()/
// quotationQuestionKind()/the Project capability's own question detection.
function clientQuestionKind(message: string): ClientQuestionKind {
  const normalized = message.toLowerCase();
  // Checked first: "how many projects does client X have" must win over the generic "how many"
  // count check below (it asks about the client's Projects, not a count of Client records).
  if (/\bprojects?\b/.test(normalized) && /\bclient\b/.test(normalized)) return "projects";
  if (/\bclient details?\b|\bdetails? for (?:the )?client\b|\bclient info(?:rmation)?\b/.test(normalized)) return "detail";
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

// PART 8: a specific Client's detail summary may include project/quotation COUNTS, always
// computed in code from a bounded head-only count query - never full rows handed to the model to
// tally, and never a duplicate of the Quotation capability's own detail/list behavior.
async function clientDetailAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  client: ClientRow,
): Promise<NoaCapabilityResult> {
  const [{ count: projectCount }, { count: quotationCount }] = await Promise.all([
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("client_id", client.id),
    supabase.from("quotations").select("id", { count: "exact", head: true }).eq("client_id", client.id),
  ]);
  const projects = projectCount ?? 0;
  const quotations = quotationCount ?? 0;

  return {
    data: {
      client: safeClientRow(client),
      kind: "client_record_detail",
      projectCount: projects,
      quotationCount: quotations,
      deterministicText: `${client.company_name} is ${archiveState(client)}, with ${projects} project${projects === 1 ? "" : "s"} and ${quotations} quotation${quotations === 1 ? "" : "s"}.`,
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
): Promise<NoaCapabilityResult> {
  try {
    await requireActiveUser();
  } catch (error) {
    if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
    throw error;
  }

  const supabase = await createClient();
  const kind = clientQuestionKind(message);

  if (kind === "detail" || kind === "projects") {
    const target = clientTarget(message);
    if (!target) {
      return { message: "Please specify the client name or number.", ok: false, reason: "ambiguous" };
    }

    const client = await findClient(supabase, target);
    if (!client) {
      return { message: "I couldn't find that client record.", ok: false, reason: "not_found" };
    }

    return kind === "projects"
      ? clientProjectsAnswer(supabase, client, /\b(how many|count|number of)\b/.test(message.toLowerCase()))
      : clientDetailAnswer(supabase, client);
  }

  return clientListAnswer(supabase, message, kind === "count");
}
