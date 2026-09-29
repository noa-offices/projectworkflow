import "server-only";
import { readNoaClients } from "./noa-client-capability.server";

import { requireQuotationActionUser } from "@/lib/auth";
import { runAiProvider } from "@/lib/ai/provider-router.server";
import { resolveAiAgentRuntimeConfig } from "@/lib/ai/resolve-agent-runtime-config.server";
import { AiProviderError } from "@/lib/ai/types";
import { fetchNoaProjectCapability } from "@/lib/noa/noa-project-capability.server";
import { fetchNoaQuotationCapability, quotationStatusDisplayLabel } from "@/lib/noa/noa-quotation-capability.server";
import { createClient } from "@/lib/supabase/server";
import { withNoaSpokenResponse } from "@/lib/noa/noa-spoken-response";
import type { NoaAnswer, NoaPageContext } from "@/lib/noa/noa-types";
import { buildNoaPlannerSchema, type NoaPlannerInput } from "./noa-semantic-planner";

// Phase 2 Core provider boundary. Reuses the existing NOA runtime ("noa_orchestrator") and the
// single provider router exactly like noa-intent-extractor.server.ts; provider differences stay
// inside lib/ai/providers. Returns the raw parsed object for validateNoaSemanticPlan(), or null
// when the planner is unavailable (disabled, provider error, timeout, non-JSON). Never retried
// across providers, never a fabricated plan.
const PLANNER_TIMEOUT_MS = 4_000;

const PLANNER_INSTRUCTIONS = `You plan one ProjectWorkflow chat turn against the user's earlier result sets. You never answer, compute facts, or decide access.
Choose exactly one kind:
- "client_lookup": list active clients (lookupText null), or find a client by a complete name/number/code copied verbatim from the CURRENT message (lookupText 2-120 characters). For example "Show Apex Luxury Retail", "Find Apex Luxury Retail", "Show the client Apex Luxury Retail", or "Tell me about TechCorp Solutions". Never invent a name, shorten it to a coincidental word, or search contact details. All other fields are null. Requests for existing Client results use select, not lookup. Unsupported Client analytics/counts/writes pass through.
- Client entity/list references use exactly the same select/ordinal/older-scope precedence as quotations and Project Files. "What projects do they have?" from Client scope uses client.project_file; "What quotations are for this client?" uses client.quotation. Choose the SOURCE Client handle (focused if compatible, otherwise most recent compatible older Client); the requested target type is not the source scope. Never substitute a generic Project/Quotation list query.
- "project_fact": a contextual Project File total-value question. Set fact to "total_value". Use the focused Project File ENTITY, or the most recent compatible older Project File entity when the user explicitly names Project scope. Never use a quotation's value or a list. If no safe entity exists, use a null handle to ask which Project. For an unqualified "its value", do not bind an older differently-typed scope.
- "quotation_lookup": find quotations by a business name/context explicitly supplied in the CURRENT message, even without earlier results. Copy only the complete business name verbatim into lookupText (2-120 characters); never shorten it to a coincidental word, invent a name, or choose a record. All other fields are null. For example, "Can you check Galleria Mall quotation?", "Show the Galleria Mall quotation.", "Find the quotation for Galleria Mall.", and "Which quotation is for Galleria Mall?" all supply lookupText "Galleria Mall". A reference to earlier quotations without a new business name uses select instead.
- "select": the user refers back to an earlier entity/list result set itself ("list them", "show those again", "go back to the quotations", "go back to the projects") or to one displayed item of it ("the second one"). Quotation and Project File result sets are handled identically.
- "relation": the user asks about records related to an earlier result set, or to one displayed item of it (use a listed relation and a handle whose entityType/kind the relation accepts).
- "aggregate_drilldown": the user asks for the records behind one status group of an earlier quotation status summary (use that aggregate's handle and one of its group statuses).
- "clarify": the user refers to earlier results but more than one result set fits, or none can be chosen safely. Never guess between candidates.
- "passthrough": anything else, including other new questions, other domains, and unsupported facts. Never interpret unrelated business requests as quotation lookup.
Reference precedence (apply in this exact order for "select" and for the source of "relation"):
1. If the user's words explicitly name an entity type/scope (e.g. "the quotations", "the projects") AND the currently FOCUSED result set already matches that entity type/scope, is selectable, and is compatible with the requested action - ALWAYS use the FOCUSED result set. Words like "go back", "again", or "earlier" do NOT by themselves mean an older result set: check whether the focused result set already satisfies what was named BEFORE looking at history. If it does, stay on it.
2. Only if the explicitly named entity type/scope does NOT match the focused result set, choose the most recent (lowest recency) selectable, compatible OLDER result set of that named scope instead.
3. If the reference is unqualified - no explicit entity type/scope is named (pronouns such as them/these/those/it/this, or a bare "list them"/"show them again" with no other detail) - use the FOCUSED selectable result set. Do this even when an older, differently-typed result set also exists.
4. Every result set has a "selectable" flag. Regardless of rules 1-3, you MUST choose a handle whose selectable is true for "select" and for the source of "relation" - NEVER an aggregate handle (selectable is always false for a status summary/aggregate of counts by status), even if it is the only or the most recent result set of the named/focused scope.
5. Use "aggregate_drilldown" instead of "select" only when the user's words name or imply a status summary/counts/a status group to drill into.
Example A (rule 1 - named scope already matches focus; stay on it, do not search history): the result sets are, older to newer, a quotation status summary (aggregate) and a list of 2 client-confirmed quotations (list, selectable: true, currently FOCUSED). The user says "Go back to the quotations." The focused result set is already a selectable quotation list - "quotations" is already satisfied by focus, so "go back" does not mean the older aggregate. Return {"kind":"select","sourceResultSetHandle":"<the FOCUSED quotation list's handle>","relation":null,"status":null,"ordinal":null}, never the older aggregate.
Example B (rule 2 - named scope does not match focus; go to the compatible older result): the result sets are, older to newer, a list of 2 client-confirmed quotations (list, selectable: true) and a list of 2 Project Files (list, selectable: true, currently FOCUSED). The user says "Go back to the quotations." The focused result set is Project Files, not quotations - the named scope does not match focus, so return {"kind":"select","sourceResultSetHandle":"<the OLDER quotation list's handle>","relation":null,"status":null,"ordinal":null}.
Example C (rule 3 - unqualified reference stays on focus): same result sets as Example B (focused: the Project Files list; older: the quotation list). The user says "List them." No entity type/scope is named - the focused Project Files list is what "them" means, even though an older quotation list also exists. Return {"kind":"select","sourceResultSetHandle":"<the FOCUSED Project Files list's handle>","relation":null,"status":null,"ordinal":null}.
Example D (rule 2, reversed domains): the result sets are, older to newer, a list of 2 Project Files (list, selectable: true) and a list of 2 quotations (list, selectable: true, currently FOCUSED). The user says "Go back to the projects." The focused result set is quotations, not Project Files - return {"kind":"select","sourceResultSetHandle":"<the OLDER Project Files list's handle>","relation":null,"status":null,"ordinal":null}.
Example E (rule 3 with a single entity): the currently FOCUSED result set is one Project File (entity, selectable: true). The user says "Tell me about it." "it" is unqualified - return {"kind":"select","sourceResultSetHandle":"<the FOCUSED Project File entity's handle>","relation":null,"status":null,"ordinal":null}.
"ordinal" is a 1-based position in the list as it was displayed, or "last"; use null unless the user names a position.
Use null for fields that do not apply.`;

// Debug-only outcome/error taxonomy for the diagnostic below. Never changes what this function
// returns to its caller - every branch below still resolves to `null` on any failure, exactly as
// before. See NOA_PLANNER_DIAG_ENV_VALUE for the gate.
type NoaPlannerDiagOutcome =
  | "success" | "runtime_disabled" | "credential_missing" | "timeout" | "provider_failed" | "invalid_json" | "unexpected_error";

const NOA_PLANNER_DIAG_ENV_VALUE = "1";
function isNoaPlannerDiagnosticsEnabled(): boolean {
  return process.env.NOA_DEBUG_ROUTING === NOA_PLANNER_DIAG_ENV_VALUE;
}

// Safe, closed metadata only - see the module comment above for exactly what this must never
// contain (no prompt, no userContent/planner input, no raw provider text, no identifiers/secrets).
function logNoaPlannerDiagnostic(fields: {
  provider?: string; model?: string; runtimeEnabled?: boolean; apiKeyConfigured?: boolean;
  providerSource?: string; modelSource?: string; timeoutMs: number; outcome: NoaPlannerDiagOutcome;
  durationMs: number; providerErrorKind?: AiProviderError["kind"];
}): void {
  if (!isNoaPlannerDiagnosticsEnabled()) return;
  try {
    console.info("[NOA_PLANNER_DIAG]", JSON.stringify(fields));
  } catch { /* diagnostics can never affect planner behavior */ }
}

export async function requestNoaSemanticPlan(input: NoaPlannerInput): Promise<unknown | null> {
  const started = performance.now();
  let runtime: Awaited<ReturnType<typeof resolveAiAgentRuntimeConfig>> | undefined;
  try {
    runtime = await resolveAiAgentRuntimeConfig("noa_orchestrator");
    const common = {
      provider: runtime.provider, model: runtime.model, runtimeEnabled: runtime.enabled,
      apiKeyConfigured: runtime.apiKeyConfigured, providerSource: runtime.source?.provider, modelSource: runtime.source?.model,
      timeoutMs: PLANNER_TIMEOUT_MS,
    };
    if (!runtime.enabled) {
      logNoaPlannerDiagnostic({ ...common, outcome: "runtime_disabled", durationMs: Math.round(performance.now() - started) });
      return null;
    }
    if (!runtime.apiKeyConfigured) {
      logNoaPlannerDiagnostic({ ...common, outcome: "credential_missing", durationMs: Math.round(performance.now() - started) });
      return null;
    }
    const response = await runAiProvider({
      model: runtime.model,
      provider: runtime.provider,
      responseSchema: { name: "noa_semantic_plan", schema: buildNoaPlannerSchema(input) },
      systemInstructions: PLANNER_INSTRUCTIONS,
      timeoutMs: PLANNER_TIMEOUT_MS,
      userContent: input,
    });
    if (!response.text) {
      logNoaPlannerDiagnostic({ ...common, outcome: "invalid_json", durationMs: Math.round(performance.now() - started) });
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text) as unknown;
    } catch {
      logNoaPlannerDiagnostic({ ...common, outcome: "invalid_json", durationMs: Math.round(performance.now() - started) });
      return null;
    }
    logNoaPlannerDiagnostic({ ...common, outcome: "success", durationMs: Math.round(performance.now() - started) });
    return parsed;
  } catch (error) {
    const common = runtime ? {
      provider: runtime.provider, model: runtime.model, runtimeEnabled: runtime.enabled,
      apiKeyConfigured: runtime.apiKeyConfigured, providerSource: runtime.source?.provider, modelSource: runtime.source?.model,
      timeoutMs: PLANNER_TIMEOUT_MS,
    } : { timeoutMs: PLANNER_TIMEOUT_MS };
    if (error instanceof AiProviderError) {
      const outcome: NoaPlannerDiagOutcome = error.kind === "timeout" ? "timeout"
        : error.kind === "not_configured" ? "credential_missing" : "provider_failed";
      logNoaPlannerDiagnostic({ ...common, outcome, providerErrorKind: error.kind, durationMs: Math.round(performance.now() - started) });
    } else {
      logNoaPlannerDiagnostic({ ...common, outcome: "unexpected_error", durationMs: Math.round(performance.now() - started) });
    }
    return null;
  }
}

// Bounded authorized lookups per answer; the ResultSet itself still holds up to 50 references.
const MAX_RENDERED_ITEMS = 10;

// Deterministic renderer: every fact is re-fetched through the existing authorized Project
// capability (requireActiveUser + RLS client) one exact order number at a time. Nothing is read
// from the ResultSet except identifiers, and no names are written back into state.
export async function describeNoaRelatedProjectFiles(
  orderNos: string[], context: NoaPageContext, framing: "related" | "selected" = "related",
): Promise<NoaAnswer> {
  const lines: string[] = [];
  for (const orderNo of orderNos.slice(0, MAX_RENDERED_ITEMS)) {
    const result = await fetchNoaProjectCapability(orderNo, context, { entity: { type: "project_file", text: orderNo } });
    const text = result.ok && typeof result.data === "object" && result.data !== null && "deterministicText" in result.data
      ? result.data.deterministicText : undefined;
    if (typeof text === "string" && text.trim()) lines.push(`- ${text.trim()}`);
  }
  const hidden = Math.max(0, orderNos.length - MAX_RENDERED_ITEMS);
  const single = lines.length === 1 && hidden === 0;
  const heading = framing === "selected"
    ? (single ? "That Project File" : `These are the ${orderNos.length} Project Files`)
    : (single ? "That quotation belongs to this Project File" : "Those quotations belong to these Project Files");
  const text = lines.length === 0
    ? (framing === "selected" ? "I couldn't find any of those Project Files." : "None of those quotations is linked to a Project File I can show you.")
    : [`${heading}:`,
      ...lines, ...(hidden ? [`…and ${hidden} more.`] : [])].join("\n");
  return withNoaSpokenResponse({
    domain: "Project",
    sources: [{ label: "Project · Checked related Project Files", type: "project_file" }],
    text,
  });
}

function isNextRedirectError(error: unknown): boolean {
  return error instanceof Error && "digest" in error && typeof (error as Error & { digest?: unknown }).digest === "string"
    && (error as Error & { digest: string }).digest.startsWith("NEXT_REDIRECT");
}

// Deterministic quotation renderer for planner-selected/drilled-down quotation ResultSets. Ids are
// hints only: rows are re-fetched through the same auth gate + RLS client as the relation service,
// in the ResultSet's display order. A single item reuses the existing authorized Quotation detail
// capability; names/status labels are never written back into state.
export async function describeNoaQuotations(ids: string[], context: NoaPageContext): Promise<NoaAnswer> {
  const sources = [{ label: "Checked quotations", type: "quotation" }];
  try {
    await requireQuotationActionUser();
  } catch (error) {
    if (isNextRedirectError(error)) return withNoaSpokenResponse({ domain: "Quotation", sources: [], text: "You don't have access to quotations." });
    throw error;
  }
  const supabase = await createClient();
  const shown = ids.slice(0, MAX_RENDERED_ITEMS);
  const { data } = await supabase.from("quotations").select("id,quotation_no,status").in("id", shown)
    .returns<Array<{ id: string; quotation_no: string | null; status: string | null }>>();
  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  const rows = shown.flatMap((id) => byId.get(id) ?? []);
  if (rows.length === 0) return withNoaSpokenResponse({ domain: "Quotation", sources, text: "I couldn't find any of those quotations." });

  if (ids.length === 1 && rows[0].quotation_no) {
    const quotationNo = rows[0].quotation_no;
    const detail = await fetchNoaQuotationCapability(quotationNo, context, { quotation: { quotationNo, request: "detail" } });
    const candidate = detail.ok && typeof detail.data === "object" && detail.data !== null ? detail.data as Record<string, unknown> : {};
    // The legacy identifier capability uses contains matching. Never borrow another revision's facts.
    const fact = candidate.id === rows[0].id ? candidate : {};
    const reference = typeof fact.reference === "string" && fact.reference && fact.reference !== quotationNo ? ` (${fact.reference})` : "";
    const client = typeof fact.client === "string" && fact.client ? ` for ${fact.client}` : "";
    const status = rows[0].status ? ` is ${quotationStatusDisplayLabel(rows[0].status)}` : "";
    return withNoaSpokenResponse({ domain: "Quotation", sources: detail.ok ? detail.sources : sources, text: `${quotationNo}${reference}${client}${status}.` });
  }
  const lines = rows.map((row) => `- ${row.quotation_no ?? "Quotation"}${row.status ? ` (${quotationStatusDisplayLabel(row.status)})` : ""}`);
  const hidden = Math.max(0, ids.length - rows.length);
  return withNoaSpokenResponse({
    domain: "Quotation", sources,
    text: [`${ids.length === 1 ? "That quotation" : `These are the ${ids.length} quotations`}:`, ...lines, ...(hidden ? [`…and ${hidden} more.`] : [])].join("\n"),
  });
}

// Project File confirmed-order total, fetched through the existing authenticated capability.
// Match the returned identity again: a stale order number must never fall through to a reference match.
export async function describeNoaProjectTotal(orderNo: string, context: NoaPageContext): Promise<NoaAnswer> {
  const result = await fetchNoaProjectCapability(orderNo, context, { entity: { type: "project_file", text: orderNo } });
  const data = result.ok ? result.data as { projectFile?: { orderNo?: unknown; total?: unknown; currency?: unknown } } : null;
  const project = data?.projectFile;
  const valid = project?.orderNo === orderNo && typeof project.total === "number" && Number.isFinite(project.total)
    && typeof project.currency === "string" && project.currency.trim();
  const text = valid
    ? `This Project File has a total value of ${project.currency} ${(project.total as number).toLocaleString("en-US", { maximumFractionDigits: 2 })}.`
    : "I couldn't retrieve the total value of that Project File. Please select the Project File again.";
  return withNoaSpokenResponse({ domain: "Project", sources: result.ok ? result.sources : [], text });
}
export async function lookupNoaClients(lookupText: string | null): Promise<{ ids: string[]; message?: string }> {
  const result = await readNoaClients({ lookupText });
  return { ids: result.rows.map((row) => row.id), message: result.message };
}

export async function describeNoaClients(ids: string[]): Promise<NoaAnswer> {
  const result = await readNoaClients({ ids });
  const lines = result.rows.map((row) => {
    const refs = [...new Set([row.clientNumber, row.clientCode].filter(Boolean))];
    return `${row.name}${refs.length ? ` (${refs.join(" / ")})` : ""} — ${row.archiveState}`;
  });
  const text = result.message ?? (lines.length === 0 ? "I couldn't find those clients."
    : ids.length === 1 ? `${lines[0]}.`
    : [`Showing ${lines.length} clients:`, ...lines.map((line) => `- ${line}`)].join("\n"));
  return withNoaSpokenResponse({ domain: "Client", sources: [{ label: "Checked clients", type: "client_record" }], text });
}
