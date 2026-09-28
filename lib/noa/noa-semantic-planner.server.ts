import "server-only";

import { runAiProvider } from "@/lib/ai/provider-router.server";
import { resolveAiAgentRuntimeConfig } from "@/lib/ai/resolve-agent-runtime-config.server";
import { fetchNoaProjectCapability } from "@/lib/noa/noa-project-capability.server";
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
- "relation": the user asks about records related to an earlier result set (use a listed relation and a handle whose entityType/kind the relation accepts).
- "aggregate_drilldown": the user asks for the records behind one status group of an earlier quotation status summary (use that aggregate's handle and one of its group statuses).
- "clarify": the user clearly refers to earlier results but you cannot tell which result set.
- "passthrough": anything else, including new questions that do not depend on earlier results.
Prefer the focused result set when the reference is implicit. Use null for fields that do not apply.`;

export async function requestNoaSemanticPlan(input: NoaPlannerInput): Promise<unknown | null> {
  try {
    const runtime = await resolveAiAgentRuntimeConfig("noa_orchestrator");
    if (!runtime.enabled || !runtime.apiKeyConfigured) return null;
    const response = await runAiProvider({
      model: runtime.model,
      provider: runtime.provider,
      responseSchema: { name: "noa_semantic_plan", schema: buildNoaPlannerSchema(input) },
      systemInstructions: PLANNER_INSTRUCTIONS,
      timeoutMs: PLANNER_TIMEOUT_MS,
      userContent: input,
    });
    return response.text ? JSON.parse(response.text) as unknown : null;
  } catch {
    return null;
  }
}

// Bounded authorized lookups per answer; the ResultSet itself still holds up to 50 references.
const MAX_RENDERED_PROJECT_FILES = 10;

// Deterministic renderer: every fact is re-fetched through the existing authorized Project
// capability (requireActiveUser + RLS client) one exact order number at a time. Nothing is read
// from the ResultSet except identifiers, and no names are written back into state.
export async function describeNoaRelatedProjectFiles(orderNos: string[], context: NoaPageContext): Promise<NoaAnswer> {
  const lines: string[] = [];
  for (const orderNo of orderNos.slice(0, MAX_RENDERED_PROJECT_FILES)) {
    const result = await fetchNoaProjectCapability(orderNo, context, { entity: { type: "project_file", text: orderNo } });
    const text = result.ok && typeof result.data === "object" && result.data !== null && "deterministicText" in result.data
      ? result.data.deterministicText : undefined;
    if (typeof text === "string" && text.trim()) lines.push(`- ${text.trim()}`);
  }
  const hidden = Math.max(0, orderNos.length - MAX_RENDERED_PROJECT_FILES);
  const text = lines.length === 0
    ? "None of those quotations is linked to a Project File I can show you."
    : [`${lines.length === 1 && hidden === 0 ? "That quotation belongs to this Project File" : "Those quotations belong to these Project Files"}:`,
      ...lines, ...(hidden ? [`…and ${hidden} more.`] : [])].join("\n");
  return withNoaSpokenResponse({
    domain: "Project",
    sources: [{ label: "Project · Checked related Project Files", type: "project_file" }],
    text,
  });
}
