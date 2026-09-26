import type { NoaDomain } from "../noa-types";

export type NoaAgentId = "quotation_agent" | "project_agent" | "sales_client_agent" | "procurement_agent" | "product_price_agent" | "admin_insights_agent";
export type NoaAgentDefinition = Readonly<{
  id: NoaAgentId;
  label: string;
  description: string;
  allowedDomains: readonly NoaDomain[];
}>;

// Structural planning permission is NEVER capability authorization. A2 must enter each
// existing capability's normal requireActiveUser/permission path with server-owned context,
// including Product Library, Procurement, payment visibility and Admin gates. Revalidate
// before execution; dependency results cannot grant authority or become executable input.
// Canonical messages come from already-resolved requests, not raw language interpretation.
// No business facts, auth context, transcripts, or capability results belong in a plan.
export type NoaAgentPlanStep = Readonly<{
  stepId: string;
  agentId: NoaAgentId;
  domain: NoaDomain;
  canonicalMessage: string;
  dependsOn: readonly string[];
}>;
export type NoaAgentPlan = Readonly<{
  mode: "single" | "multi";
  responseMode: "direct" | "compose";
  steps: readonly NoaAgentPlanStep[];
}>;
export type NoaAgentPlanValidation =
  | { ok: true }
  | { ok: false; reason: "invalid_shape" | "invalid_mode" | "step_limit" | "invalid_step" | "unknown_agent" | "unknown_domain" | "domain_not_allowed" | "scope_not_allowed" | "duplicate_step" | "invalid_dependency" | "dependency_cycle" };
