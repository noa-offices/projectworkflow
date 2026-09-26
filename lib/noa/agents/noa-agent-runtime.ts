import type { NoaAnswer, NoaChatRequest } from "../noa-types";
import type { NoaAgentPlan } from "./noa-agent-types";
import type { NoaAgentPlanExecution } from "./noa-agent-execution-types";
import { validateNoaAgentPlan } from "./noa-agent-planner";
import { composeNoaAgentExecution } from "./noa-agent-composer";

// Internal dependency seam. The orchestrator supplies fixed existing server capabilities.
type Dependencies = {
  validIdentifier: (type: "quotation" | "project_file", label: string) => boolean;
  resolveClient: (candidate: string) => Promise<string | null>;
  execute: (plan: NoaAgentPlan, context: NoaChatRequest["context"]) => Promise<NoaAgentPlanExecution>;
};
export async function tryNoaAgentBrief(request: NoaChatRequest, enabled: boolean, deps: Dependencies): Promise<NoaAnswer | null> {
  if (!enabled) return null;
  const match = request.message.trim().match(/^(?:give me (?:a |an )?)?(complete update|project briefing|client briefing|client overview|quotation briefing|quotation overview)(?:\s+(?:on|for)\s+(.+?))?[.!?]?$/i);
  if (!match) return null;
  const cue = match[1].toLowerCase();
  const domain = cue.startsWith("client") ? "Client" : cue.startsWith("quotation") ? "Quotation" : "Project";
  const clarify = (): NoaAnswer => ({ domain, sources: [], text: domain === "Client" ? "Please give the exact client name for this briefing." : `Please give one valid ${domain === "Project" ? "CO" : "QN"} number for this briefing.` });
  let label = match[2]?.trim();
  if (!label || label.length > 160) return clarify();
  if (domain === "Client") {
    const resolved = await deps.resolveClient(label);
    if (!resolved || resolved.toLowerCase() !== label.toLowerCase()) return clarify();
    label = resolved;
  } else if (!deps.validIdentifier(domain === "Project" ? "project_file" : "quotation", label)) return clarify();
  const primary: NoaAgentPlan["steps"][number] = { stepId: "primary", agentId: domain === "Project" ? "project_agent" as const : domain === "Client" ? "sales_client_agent" as const : "quotation_agent" as const,
    domain, canonicalMessage: domain === "Project" ? `project details for ${label}` : domain === "Client" ? `tell me about client ${label}` : `tell me about ${label}`, dependsOn: [] };
  const plan: NoaAgentPlan = domain === "Project" ? { mode: "multi", responseMode: "compose", steps: [primary,
    { stepId: "procurement", agentId: "procurement_agent", domain: "Procurement", canonicalMessage: `order details for ${label}`, dependsOn: ["primary"] },
    { stepId: "history", agentId: "project_agent", domain: "UserActivity", canonicalMessage: `what changed on ${label}`, dependsOn: ["primary"] },
  ] } : { mode: "single", responseMode: "direct", steps: [primary] };
  if (!validateNoaAgentPlan(plan).ok) return clarify();
  const execution = await deps.execute(plan, request.context);
  const composition = composeNoaAgentExecution(plan, execution, domain === "Project" ? "project_brief" : domain === "Client" ? "client_brief" : "quotation_brief");
  if (composition.status === "failed") return { domain, sources: [], text: "A briefing was not available for this request." };
  return { domain, sources: [], text: composition.title,
    agentBrief: { title: composition.title, summary: composition.summary, partial: composition.partial,
      sections: composition.sections.map(({ heading, facts }) => ({ heading, facts })), omissions: composition.omissions },
    conversationReference: { domain, intent: domain === "Project" ? "project_lookup" : domain === "Client" ? "client_lookup" : "quotation_lookup",
      entities: [{ type: domain === "Project" ? "project_file" : domain === "Client" ? "client" : "quotation", label }] },
  };
}
