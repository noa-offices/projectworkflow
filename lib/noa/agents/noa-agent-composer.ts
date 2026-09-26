import type { NoaDomain } from "../noa-types";
import type { NoaAgentPlan } from "./noa-agent-types";
import type { NoaAgentStepExecution } from "./noa-agent-execution-types";
import type { NoaAgentComposition, NoaAgentCompositionSection, NoaAgentCompositionRecipeId } from "./noa-agent-composition-types";
import { NOA_AGENT_COMPOSITION_RECIPES } from "./noa-agent-recipes";
import { validateNoaAgentPlan, MAX_AGENT_PLAN_STEPS } from "./noa-agent-planner";

export const MAX_COMPOSITION_SECTIONS = MAX_AGENT_PLAN_STEPS;
export const MAX_COMPOSITION_FACTS = 8;
export const MAX_COMPOSITION_TEXT_LENGTH = 500;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const HEADINGS: Partial<Record<NoaDomain, string>> = { Project: "Project", Procurement: "Procurement", UserActivity: "Recent changes", Insights: "Analytics", Client: "Client", Quotation: "Quotation" };

// Only existing display-ready prose from explicitly known capability result kinds.
// Rows, source record IDs, audit items, metadata and financial arrays are never read.
const KINDS: Partial<Record<NoaDomain, readonly string[]>> = {
  Project: ["project_file_detail", "project_record_detail"],
  Procurement: ["procurement_order_detail", "procurement_order_count", "procurement_order_list"],
  UserActivity: ["user_activity_catch_up"],
  Client: ["client_record_detail", "client_project_count", "client_project_list", "client_project_file_count", "client_project_file_list"],
  Quotation: ["quotation_relation_read", "quotation_total", "quotation_status_count", "quotation_status_list", "quotation_comparison"],
  Insights: ["insights_client_ranking", "insights_client_summary", "insights_project_summary", "insights_project_file_analytics", "insights_quotation_summary", "insights_quotation_analytics", "insights_quotation_compare", "insights_quotation_trend", "insights_procurement_summary", "insights_procurement_analytics", "insights_payment_analytics"],
};
function safeLine(value: string): boolean {
  return value.length <= MAX_COMPOSITION_TEXT_LENGTH && !/[\u0000-\u0008\u000b-\u001f]/.test(value) &&
    !/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(value);
}

/** @internal Pure testable projection. Production callers use the server-only facade. */
export function projectAgentStepResultForComposition(step: NoaAgentStepExecution): { section: NoaAgentCompositionSection; omitted: boolean; kind: string } | null {
  if (step.status !== "success" || step.result.ok !== true || !object(step.result.data)) return null;
  const data = step.result.data;
  let text: string;
  let kind: string;
  if (step.domain === "Quotation" && data.kind === undefined && typeof data.quotationNo === "string" && /^QN-\d+-\d+$/.test(data.quotationNo)) {
    // Detail has no kind/deterministicText. Copy only existing user-facing string fields;
    // do not format totals, enumerate items, or fall back to its internal id.
    kind = "quotation_detail";
    text = ["quotationNo", "title", "reference", "client", "project", "status"].flatMap(key => typeof data[key] === "string" ? [`${key}: ${data[key]}`] : []).join("\n");
  } else {
    if (typeof data.kind !== "string" || !KINDS[step.domain]?.includes(data.kind) || typeof data.deterministicText !== "string") return null;
    kind = data.kind;
    text = data.deterministicText;
  }
  // Bound work and output. Drop whole lines, never cut identifiers or financial facts.
  if (text.length > 16000) return null;
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const facts = lines.filter(safeLine).slice(0, MAX_COMPOSITION_FACTS);
  if (!facts.length) return null;
  return { section: { heading: kind === "insights_payment_analytics" ? "Payment" : HEADINGS[step.domain]!, facts, sourceStepId: step.stepId }, omitted: facts.length !== lines.length, kind };
}

/** @internal Compose same-request, server-owned A2 results only. Shape matching is not
 * authentication or provenance proof; never expose this as a client submission endpoint. */
export function composeNoaAgentExecution(planInput: unknown, execution: unknown, recipeId: unknown): NoaAgentComposition {
  if (typeof recipeId !== "string" || !Object.hasOwn(NOA_AGENT_COMPOSITION_RECIPES, recipeId)) return { status: "failed", reason: "invalid_recipe" };
  if (!validateNoaAgentPlan(planInput).ok) return { status: "failed", reason: "invalid_plan" };
  const plan = planInput as NoaAgentPlan;
  const recipe = NOA_AGENT_COMPOSITION_RECIPES[recipeId as NoaAgentCompositionRecipeId];
  if (plan.steps.some(step => !recipe.domains.includes(step.domain))) return { status: "failed", reason: "recipe_scope" };
  const mismatch = (): NoaAgentComposition => ({ status: "failed", reason: "execution_mismatch" });
  if (!object(execution) || execution.responseMode !== plan.responseMode || !Array.isArray(execution.stepResults) || execution.stepResults.length !== plan.steps.length) return mismatch();
  const results = new Map<string, NoaAgentStepExecution>();
  for (const result of execution.stepResults) {
    if (!object(result)) return mismatch();
    const step = plan.steps.find(step => step.stepId === result.stepId);
    const dependencies = result.dependsOn;
    if (!step || results.has(step.stepId) || result.agentId !== step.agentId || result.domain !== step.domain ||
      !Array.isArray(dependencies) || dependencies.length !== step.dependsOn.length || !step.dependsOn.every((id, index) => dependencies[index] === id)) return mismatch();
    if (result.status === "success" || result.status === "refused") {
      if (!object(result.result) || result.result.ok !== (result.status === "success")) return mismatch();
      if (result.status === "success" && (!Object.hasOwn(result.result, "data") || !Array.isArray(result.result.sources))) return mismatch();
      if (result.status === "refused" && !["unauthorized", "not_found", "ambiguous"].includes(String(result.result.reason))) return mismatch();
    } else if (result.status === "failed") {
      if (result.reason !== "capability_exception" && result.reason !== "scope_rejected") return mismatch();
    } else if (result.status !== "skipped" || result.reason !== "dependency_not_successful") return mismatch();
    results.set(step.stepId, result as NoaAgentStepExecution);
  }
  if (execution.completed !== [...results.values()].every(result => result.status === "success")) return mismatch();
  for (const step of plan.steps) {
    const blocked = step.dependsOn.some(id => results.get(id)?.status !== "success");
    if (blocked !== (results.get(step.stepId)!.status === "skipped")) return mismatch();
  }
  const sections: NoaAgentCompositionSection[] = [];
  const omissions: string[] = [];
  let primary = false;
  for (const step of plan.steps) {
    const projection = projectAgentStepResultForComposition(results.get(step.stepId)!);
    // Client briefs accept existing client analytics only, not arbitrary Insights output.
    if (!projection || (recipeId === "client_brief" && step.domain === "Insights" && !["insights_client_ranking", "insights_client_summary"].includes(projection.kind))) {
      omissions.push(`${HEADINGS[step.domain]} information was not available for this request.`);
      continue;
    }
    if (step.domain === recipe.primary) primary = true;
    sections.push(projection.section);
    if (projection.omitted) omissions.push(`${projection.section.heading}: some display text was omitted to keep this briefing bounded.`);
  }
  if (!primary) return { status: "failed", reason: "primary_unavailable" };
  const partial = omissions.length > 0;
  return { status: partial ? "partial" : "complete", title: recipe.title,
    summary: "Authorized results for the planned requests. Each section retains its own scope.",
    sections, sourceSteps: sections.map(section => section.sourceStepId), partial, omissions };
}
