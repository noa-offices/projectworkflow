import { tool } from "ai";
import { z } from "zod";
import { fetchNoaAttentionCapability } from "@/lib/noa/noa-attention-capability.server";
import { fetchNoaInsightsCapability } from "@/lib/noa/noa-insights-capability.server";
import { fetchNoaPriceCapability } from "@/lib/noa/noa-price-capability.server";
import { fetchNoaProductCapability } from "@/lib/noa/noa-product-capability.server";
import { fetchNoaQuotationCapability } from "@/lib/noa/noa-quotation-capability.server";
import { fetchNoaUserActivityCapability } from "@/lib/noa/noa-user-activity-capability.server";
import type { NoaCapabilityResult, NoaPageContext, NoaSource } from "@/lib/noa/noa-types";

// The activity capability picks its scope from the message text, so the model never sends it free text: closed values map to the
// exact deterministic phrasings it already classifies as team summary / own summary for a given day.
const ACTIVITY_MESSAGES = {
  team: { today: "show team activity today", yesterday: "show team activity yesterday" },
  mine: { today: "show my activity today", yesterday: "show my activity yesterday" },
} as const;

// The Insights capability also classifies by keywords in the message, so the model never sends it free text: each closed report value
// maps to the exact phrasing that selects one kind (the four client rankings are the strings the agent planner already uses).
const INSIGHT_PERIODS = { today: "today", this_week: "this week", this_month: "this month", last_month: "last month", this_year: "this year" } as const;
const INSIGHT_REPORTS = {
  quotation_summary: (period: string) => `quotation summary ${period}`,
  quotation_analytics: (period: string) => `quotation analytics ${period}`,
  quotation_trend: () => "quotation trend",
  quotation_compare: () => "compare quotations this month and last month",
  top_clients_by_quotation_value: () => "top clients by quotation value",
  top_clients_by_confirmed_value: () => "top clients by confirmed value",
  top_clients_by_project_value: () => "top clients by project value",
  quotation_count_per_client: () => "how many quotations does each client have",
  project_file_analytics: () => "project file analytics",
  project_summary: () => "project summary",
  client_summary: () => "client summary",
} as const;

/** Read-only NOA v2 tools. Each one delegates to an existing authorized capability and returns its result unchanged. */
export function createNoaAgentTools(context: NoaPageContext) {
  const sources: NoaSource[] = [];
  const collect = (result: NoaCapabilityResult) => {
    if (result.ok) sources.push(...result.sources);
    return result;
  };
  const tools = {
    searchProducts: tool({
      description: "Search product templates by name, code or description. Read-only.",
      inputSchema: z.object({ query: z.string().min(1).max(200) }),
      execute: async ({ query }) => collect(await fetchNoaProductCapability(query, context)),
    }),
    getProductPrice: tool({
      description: "Get the current price information for a product. Read-only.",
      inputSchema: z.object({ query: z.string().min(1).max(200) }),
      execute: async ({ query }) => collect(await fetchNoaPriceCapability(query, context)),
    }),
    searchQuotations: tool({
      description: "Search or summarise quotations (client, status, totals). Read-only.",
      inputSchema: z.object({ query: z.string().min(1).max(200) }),
      execute: async ({ query }) => collect(await fetchNoaQuotationCapability(query, context)),
    }),
    getQuotation: tool({
      description: "Get one quotation by its quotation number. Read-only.",
      inputSchema: z.object({ quotationNumber: z.string().min(1).max(100) }),
      execute: async ({ quotationNumber }) => collect(await fetchNoaQuotationCapability(quotationNumber, context)),
    }),
    getAttentionItems: tool({
      description: "Get the items that need the current user's attention. Read-only.",
      inputSchema: z.object({ query: z.string().min(1).max(200) }),
      execute: async ({ query }) => collect(await fetchNoaAttentionCapability(query, context)),
    }),
    getTeamActivity: tool({
      description: `Get recorded ProjectWorkflow activity for a day. Use scope "team" for questions about who worked, what the team did, or team activity; use scope "mine" only for the current user's own activity. Read-only.`,
      inputSchema: z.object({ scope: z.enum(["team", "mine"]), period: z.enum(["today", "yesterday"]) }),
      execute: async ({ scope, period }) => collect(await fetchNoaUserActivityCapability(ACTIVITY_MESSAGES[scope][period], context)),
    }),
    getInsights: tool({
      description: `Get a ProjectWorkflow business report (sales report, top clients, quotation summary). Read-only. report values: quotation_summary = quotation count and value for the period; quotation_analytics = quotation status breakdown, confirmed value and average for the period (use for "sales report" / "sales overview"); quotation_trend = quotation trend over time; quotation_compare = quotations this month versus last month; top_clients_by_quotation_value, top_clients_by_confirmed_value, top_clients_by_project_value = client rankings by that value; quotation_count_per_client = number of quotations per client; project_file_analytics = project file status and value; project_summary = project overview; client_summary = client overview. period applies only to quotation_summary and quotation_analytics (default this_month). If the user asks for something that is not in this list (for example sales by salesperson), do not call this tool; say it is not available.`,
      inputSchema: z.object({ report: z.enum(Object.keys(INSIGHT_REPORTS) as [keyof typeof INSIGHT_REPORTS, ...(keyof typeof INSIGHT_REPORTS)[]]), period: z.enum(Object.keys(INSIGHT_PERIODS) as [keyof typeof INSIGHT_PERIODS, ...(keyof typeof INSIGHT_PERIODS)[]]).optional() }),
      execute: async ({ report, period }) => collect(await fetchNoaInsightsCapability(INSIGHT_REPORTS[report](INSIGHT_PERIODS[period ?? "this_month"]), context)),
    }),
  };
  return { tools, sources };
}
