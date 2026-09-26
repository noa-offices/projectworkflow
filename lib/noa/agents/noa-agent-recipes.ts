import type { NoaDomain } from "../noa-types";
import type { NoaAgentCompositionRecipeId } from "./noa-agent-composition-types";

type Recipe = Readonly<{ title: string; primary: NoaDomain; domains: readonly NoaDomain[] }>;
const recipe = (title: string, primary: NoaDomain, domains: NoaDomain[]): Recipe => Object.freeze({ title, primary, domains: Object.freeze(domains) });
// A1's agent/domain/scope validation remains mandatory in addition to these narrower
// recipe domains. These recipes consume already-grounded plans; they resolve no identity
// or relationships. Secondary sections retain their own scope, never an inferred relation.
export const NOA_AGENT_COMPOSITION_RECIPES: Readonly<Record<NoaAgentCompositionRecipeId, Recipe>> = Object.freeze({
  project_brief: recipe("Project briefing", "Project", ["Project", "Procurement", "UserActivity", "Insights"]),
  client_brief: recipe("Client briefing", "Client", ["Client", "Insights", "Quotation"]),
  // A1 permits CO-scoped Project history only, not QN history. Do not widen A1 here.
  // Related Project context must already be grounded by the caller before planning.
  quotation_brief: recipe("Quotation briefing", "Quotation", ["Quotation", "Project"]),
});
