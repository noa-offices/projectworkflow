import { tool } from "ai";
import { z } from "zod";
import { fetchNoaAttentionCapability } from "@/lib/noa/noa-attention-capability.server";
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
  };
  return { tools, sources };
}
