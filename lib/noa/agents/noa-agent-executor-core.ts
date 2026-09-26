import type { NoaCapabilityResult, NoaDomain, NoaPageContext } from "../noa-types";
import { validateNoaAgentPlan } from "./noa-agent-planner";
import type { NoaAgentPlan } from "./noa-agent-types";
import type { NoaAgentPlanExecution, NoaAgentStepExecution } from "./noa-agent-execution-types";

/** @internal Dependency seam for tests and the server facade only. No real adapters here. */
export type NoaAgentAdapters = Readonly<Record<Exclude<NoaDomain, "Attention" | "Help">,
  (message: string, context: NoaPageContext) => Promise<NoaCapabilityResult>>>;

/** @internal Not a runtime entry point. Call the fixed server facade in production. */
export async function executeAgentPlanWithAdapters(input: unknown, context: NoaPageContext, adapters: NoaAgentAdapters): Promise<NoaAgentPlanExecution> {
  // Snapshot before awaiting: callers cannot replace a future step while a capability runs.
  let snapshot: unknown;
  try { snapshot = structuredClone(input); } catch { throw new Error("invalid_agent_plan"); }
  if (!validateNoaAgentPlan(snapshot).ok) throw new Error("invalid_agent_plan");
  const plan = snapshot as NoaAgentPlan;
  const results = new Map<string, NoaAgentStepExecution>();
  while (results.size < plan.steps.length) {
    // First ready step in original plan order provides stable topological execution.
    const step = plan.steps.find(candidate => !results.has(candidate.stepId) && candidate.dependsOn.every(id => results.has(id)))!;
    const identity = { stepId: step.stepId, agentId: step.agentId, domain: step.domain, dependsOn: step.dependsOn };
    if (step.dependsOn.some(id => results.get(id)?.status !== "success")) {
      results.set(step.stepId, { ...identity, status: "skipped", reason: "dependency_not_successful" });
      continue;
    }
    // Reuse A1's registry AND specialist scope checks immediately before each invocation.
    if (!validateNoaAgentPlan({ mode: "single", responseMode: "direct", steps: [{ ...step, dependsOn: [] }] }).ok || step.domain === "Attention" || step.domain === "Help") {
      results.set(step.stepId, { ...identity, status: "failed", reason: "scope_rejected" });
      continue;
    }
    try {
      // Dependencies control order only. No output interpolation, auth augmentation,
      // retry, fallback capability, calculations, logging, or persistence.
      const result = await adapters[step.domain](step.canonicalMessage, context);
      results.set(step.stepId, result.ok
        ? { ...identity, status: "success", result }
        : { ...identity, status: "refused", result });
    } catch {
      // Exceptions can contain sensitive data. Keep only a closed failure reason.
      results.set(step.stepId, { ...identity, status: "failed", reason: "capability_exception" });
    }
  }
  const stepResults = [...results.values()];
  return { responseMode: plan.responseMode, stepResults, completed: stepResults.every(step => step.status === "success") };
}
