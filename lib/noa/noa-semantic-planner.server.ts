import "server-only";

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
- "select": the user refers back to an earlier entity/list result set itself ("list them", "show those again", "go back to the quotations") or to one displayed item of it ("the second one").
- "relation": the user asks about records related to an earlier result set, or to one displayed item of it (use a listed relation and a handle whose entityType/kind the relation accepts).
- "aggregate_drilldown": the user asks for the records behind one status group of an earlier quotation status summary (use that aggregate's handle and one of its group statuses).
- "clarify": the user refers to earlier results but more than one result set fits, or none can be chosen safely. Never guess between candidates.
- "passthrough": anything else, including new questions that do not depend on earlier results.
Reference precedence (apply in this order for "select" and for the source of "relation"):
1. An unqualified reference/follow-up - pronouns such as them/these/those/it/this, or a bare "list them"/"show them again" with no other detail - that does NOT explicitly name a different entity type, a status summary, or an older/earlier result - ALWAYS means the CURRENTLY FOCUSED selectable result set. Do this even when an older result set also exists, even when that older result set is a different, "more obvious" entity type (e.g. quotations), and even when a recent turn related the focused set FROM that older one. Focus, not recency or entity type, decides an unqualified reference.
2. Choose an older (non-focused, higher recency) result set ONLY when the user's current words explicitly point away from the focused result set - naming or clearly implying a different entity type, an earlier/previous result, or going "back" to something earlier ("go back to the quotations", "what about the earlier list", "the projects, not those quotations").
Every result set has a "selectable" flag. For "select" and for the source of "relation", you MUST choose a handle whose selectable is true. selectable is always false for a result set that is a status summary/aggregate (counts of quotations by status, not the quotations themselves) - NEVER choose an aggregate handle for "select" or "relation", even if it is the only or the most recent quotation-typed result set. If the user's words name or imply a status summary/counts/a status group to drill into, use "aggregate_drilldown" instead (never "select").
Example A (rule 1 - unqualified reference stays on the focused set): the result sets are, older to newer, a quotation status summary (aggregate), a list of 2 client-confirmed quotations (list, selectable: true), and a list of 2 Project Files (list, selectable: true, currently FOCUSED). The user says "List them." There is no explicit mention of quotations, status, or "back" - the focused Project Files list is what "them" means, even though an older quotation list also exists. Return {"kind":"select","sourceResultSetHandle":"<the FOCUSED Project Files list's handle>","relation":null,"status":null,"ordinal":null}.
Example B (rule 2 - explicit different scope reaches into history): same result sets as Example A (focused: the Project Files list; older: the quotation list and the aggregate). The user says "Go back to the quotations." This explicitly names quotations and "back", pointing away from the focused Project Files - return {"kind":"select","sourceResultSetHandle":"<the older quotation list's handle>","relation":null,"status":null,"ordinal":null}, never the focused set and never the aggregate (aggregates are never selectable).
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
    const fact = detail.ok && typeof detail.data === "object" && detail.data !== null ? detail.data as Record<string, unknown> : {};
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
