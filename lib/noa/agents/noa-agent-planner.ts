import type { NoaDomain } from "../noa-types";
import { agentForNoaDomain, NOA_AGENT_REGISTRY } from "./noa-agent-registry";
import type { NoaAgentId, NoaAgentPlan, NoaAgentPlanValidation } from "./noa-agent-types";

export const MAX_AGENT_PLAN_STEPS = 4;
export const MAX_AGENT_CANONICAL_MESSAGE_LENGTH = 1000;
const DOMAINS: readonly NoaDomain[] = ["Product", "Quotation", "Price", "Project", "Client", "Procurement", "UserActivity", "Admin", "Insights", "Attention", "Help"];
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value: Record<string, unknown>, expected: string[]) => Reflect.ownKeys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));

// These are existing resolver-owned canonical contracts, not a second NLP classifier.
// Keep specialist access narrower than domain access; broad Insights is admin_insights only.
function scopeAllowed(agent: NoaAgentId, domain: NoaDomain, message: string): boolean {
  if (domain === "UserActivity") return agent === "project_agent" && /^what changed on CO-\d+-\d+$/.test(message);
  if (agent === "sales_client_agent" && domain === "Insights") return [
    "top clients by quotation value", "top clients by confirmed value",
    "top clients by project value", "how many quotations does each client have",
  ].includes(message);
  return true;
}

// Accept unknown input and fail closed on extra fields (SQL, filters, auth overrides,
// nested plans, etc.). This checks structure/scope only, never the user's permissions
// or truth of a message. A2 must preserve existing compatibility and capability gates.
export function validateNoaAgentPlan(value: unknown): NoaAgentPlanValidation {
  const fail = (reason: Extract<NoaAgentPlanValidation, { ok: false }>["reason"]): NoaAgentPlanValidation => ({ ok: false, reason });
  if (!record(value) || !keys(value, ["mode", "responseMode", "steps"]) || !Array.isArray(value.steps)) return fail("invalid_shape");
  if (value.steps.length < 1 || value.steps.length > MAX_AGENT_PLAN_STEPS) return fail("step_limit");
  if (!(value.mode === "single" && value.steps.length === 1 && value.responseMode === "direct") &&
      !(value.mode === "multi" && value.steps.length >= 2 && value.responseMode === "compose")) return fail("invalid_mode");
  const dependencies = new Map<string, string[]>();
  for (const step of value.steps) {
    if (!record(step) || !keys(step, ["stepId", "agentId", "domain", "canonicalMessage", "dependsOn"]) ||
        !identifier(step.stepId) || typeof step.canonicalMessage !== "string" || !step.canonicalMessage.trim() ||
        step.canonicalMessage.length > MAX_AGENT_CANONICAL_MESSAGE_LENGTH || !Array.isArray(step.dependsOn) ||
        step.dependsOn.length >= MAX_AGENT_PLAN_STEPS || !step.dependsOn.every(identifier)) return fail("invalid_step");
    if (typeof step.agentId !== "string" || !Object.hasOwn(NOA_AGENT_REGISTRY, step.agentId)) return fail("unknown_agent");
    if (!DOMAINS.includes(step.domain as NoaDomain)) return fail("unknown_domain");
    const agent = step.agentId as NoaAgentId;
    if (!NOA_AGENT_REGISTRY[agent].allowedDomains.includes(step.domain as NoaDomain)) return fail("domain_not_allowed");
    if (!scopeAllowed(agent, step.domain as NoaDomain, step.canonicalMessage)) return fail("scope_not_allowed");
    if (dependencies.has(step.stepId)) return fail("duplicate_step");
    dependencies.set(step.stepId, step.dependsOn);
  }
  for (const [id, deps] of dependencies) {
    if (new Set(deps).size !== deps.length || deps.some(dep => dep === id || !dependencies.has(dep))) return fail("invalid_dependency");
  }
  // Bounded Kahn traversal: array order need not be topological. No recursive planning,
  // agent-to-agent calls, execution, calculations, or result interpolation occurs here.
  const complete = new Set<string>();
  for (let pass = 0; pass < MAX_AGENT_PLAN_STEPS; pass++) {
    for (const [id, deps] of dependencies) if (deps.every(dep => complete.has(dep))) complete.add(id);
  }
  return complete.size === dependencies.size ? { ok: true } : fail("dependency_cycle");
}

export function planSingleAgentRequest(input: { resolvedDomain: NoaDomain; canonicalMessage: string; agentId?: NoaAgentId }): NoaAgentPlan | null {
  const agentId = input.agentId ?? agentForNoaDomain(input.resolvedDomain);
  if (!agentId) return null;
  const plan: NoaAgentPlan = { mode: "single", responseMode: "direct", steps: [{
    stepId: "step1", agentId, domain: input.resolvedDomain, canonicalMessage: input.canonicalMessage, dependsOn: [],
  }] };
  return validateNoaAgentPlan(plan).ok ? plan : null;
}
