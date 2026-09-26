import type { NoaDomain } from "../noa-types";
import type { NoaAgentDefinition, NoaAgentId } from "./noa-agent-types";

const definition = (id: NoaAgentId, label: string, description: string, allowedDomains: NoaDomain[]): NoaAgentDefinition =>
  Object.freeze({ id, label, description, allowedDomains: Object.freeze(allowedDomains) });

export const NOA_AGENT_REGISTRY: Readonly<Record<NoaAgentId, NoaAgentDefinition>> = Object.freeze({
  quotation_agent: definition("quotation_agent", "Quotation", "Existing quotation reads", ["Quotation"]),
  project_agent: definition("project_agent", "Project", "Project reads and explicitly scoped Project history", ["Project", "UserActivity"]),
  sales_client_agent: definition("sales_client_agent", "Sales / Client", "Client reads and existing client rankings", ["Client", "Insights"]),
  procurement_agent: definition("procurement_agent", "Procurement", "Existing procurement reads", ["Procurement"]),
  product_price_agent: definition("product_price_agent", "Product / Price", "Existing Product Library and price reads", ["Product", "Price"]),
  admin_insights_agent: definition("admin_insights_agent", "Admin / Insights", "Existing administration and analytics reads", ["Admin", "Insights"]),
});

// Shared/contextual domains deliberately have no inferred owner, even when A1 enables
// only one narrow use (Project history). Attention has no proven specialist filter.
export function agentForNoaDomain(domain: NoaDomain): NoaAgentId | null {
  switch (domain) {
    case "Quotation": return "quotation_agent";
    case "Project": return "project_agent";
    case "Client": return "sales_client_agent";
    case "Procurement": return "procurement_agent";
    case "Product": case "Price": return "product_price_agent";
    case "Admin": return "admin_insights_agent";
    default: return null;
  }
}
