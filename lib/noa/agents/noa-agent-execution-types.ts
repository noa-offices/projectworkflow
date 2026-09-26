import type { NoaCapabilityResult } from "../noa-types";
import type { NoaAgentPlan, NoaAgentPlanStep } from "./noa-agent-types";

// Internal server execution results, never a client transport. Capability data stays
// behind the server-only facade; A3 must explicitly select authorized display data.
type StepIdentity = Pick<NoaAgentPlanStep, "stepId" | "agentId" | "domain" | "dependsOn">;
export type NoaAgentStepExecution = StepIdentity & (
  | { status: "success"; result: Extract<NoaCapabilityResult, { ok: true }> }
  | { status: "refused"; result: Extract<NoaCapabilityResult, { ok: false }> }
  | { status: "failed"; reason: "capability_exception" | "scope_rejected" }
  | { status: "skipped"; reason: "dependency_not_successful" }
);
export type NoaAgentPlanExecution = {
  responseMode: NoaAgentPlan["responseMode"];
  stepResults: NoaAgentStepExecution[];
  // True only when every planned step succeeded, not merely when traversal finished.
  completed: boolean;
};
