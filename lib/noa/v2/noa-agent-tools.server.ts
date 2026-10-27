import { tool } from "ai";
import { z } from "zod";
import { fetchNoaAttentionCapability } from "@/lib/noa/noa-attention-capability.server";
import { isNoaRouteDiagnosticsEnabled } from "@/lib/noa/noa-intent-router";
import { fetchNoaClientCapability } from "@/lib/noa/noa-client-capability.server";
import { fetchNoaInsightsCapability } from "@/lib/noa/noa-insights-capability.server";
import { fetchNoaPriceCapability } from "@/lib/noa/noa-price-capability.server";
import { fetchNoaProcurementCapability } from "@/lib/noa/noa-procurement-capability.server";
import { fetchNoaProductCapability } from "@/lib/noa/noa-product-capability.server";
import { fetchNoaProjectCapability } from "@/lib/noa/noa-project-capability.server";
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

// Client, Project and Procurement capabilities also classify by keywords in the message, so the model sends only closed values or a
// strictly validated identifier / name. Every message is a fixed template around that input; none contains words that switch the kind.
export const CLIENT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .,&'()-]{0,79}$/u;
export const PROJECT_FILE_NUMBER_PATTERN = /^CO-\d{3,}(?:-\d+)*$/i; // same shape as PROJECT_FILE_IDENTIFIER_PATTERN in the project capability
export const PROCUREMENT_ORDER_NUMBER_PATTERN = /^[A-Za-z]{0,4}-?\d{3,}[A-Za-z0-9-]{0,35}$/; // an order-number-shaped token, as the procurement capability expects
// Product and Price capabilities classify by keywords too. Product: how many / count / number of -> count; show / list / all / which -> list; otherwise detail.
// A brand or category in a list / count message is matched against real DB names (singular or plural), so the term is passed through unchanged.
// Price: summary / every / all / how many ... -> broad price STATUS for a brand or category; which / show / list -> status list; otherwise one product.
export const PRODUCT_TERM_PATTERN = CLIENT_NAME_PATTERN; // plain name / code: letters, digits, spaces and basic punctuation, 80 characters at most
export const PRODUCT_TERM_TRIGGERS = /\b(how many|count|number of|show|list|all|which|every|summar(?:y|ize)|overall)\b/i; // a term holding these words would switch the question kind
export const PRODUCT_MESSAGES = { list: (term: string) => `show all ${term}`, count: (term: string) => `how many ${term}` } as const;
// "detail" / "single" carry the product name only in options.product.productText, so a product named "Every" or "All" cannot switch the question kind.
export const PRODUCT_DETAIL_MESSAGE = "give me the product information";
export const PRICE_SINGLE_MESSAGE = "give me the product price";
export const PRICE_MESSAGES = { status_summary: (term: string) => `summarize ${term} price status` } as const;
const debugToolCall = (tool: string, request: string, message: string) => {
  if (isNoaRouteDiagnosticsEnabled(process.env.NODE_ENV, process.env.NOA_DEBUG_ROUTING)) console.info("[NOA_V2_TOOL]", JSON.stringify({ tool, request, message }));
};
const CLIENT_REPORTS = ["list", "count", "detail", "projects"] as const;
const PROJECT_REPORTS = ["active_list", "completed_list", "active_count", "completed_count", "detail"] as const;
const PROCUREMENT_REPORTS = ["active_list", "completed_list", "active_count", "completed_count", "order_detail"] as const;
const PROJECT_MESSAGES = {
  active_list: "show active project files", completed_list: "show completed project files",
  active_count: "how many active project files", completed_count: "how many completed project files",
} as const;
const PROCUREMENT_MESSAGES = {
  active_list: "show active procurement orders", completed_list: "show completed procurement orders",
  active_count: "how many active procurement orders", completed_count: "how many completed procurement orders",
} as const;

// OpenAI rejects pattern / minLength / maxLength / format in tool schemas, so the model-facing schemas stay plain (enums and plain strings)
// and every rule runs here, in execute, before any capability is called. A refusal uses the same result shape as the other "cannot look up" cases.
const refuse = (message: string) => ({ ok: false as const, message, reason: "ambiguous" as const });
const validText = (value: string, max: number) => value.length >= 1 && value.length <= max;
const INVALID_TEXT = "That input is not valid. Send a short plain text value.";

/** Read-only NOA v2 tools. Each one delegates to an existing authorized capability and returns its result unchanged. */
export function createNoaAgentTools(context: NoaPageContext) {
  const sources: NoaSource[] = [];
  const collect = (result: NoaCapabilityResult) => {
    if (result.ok) sources.push(...result.sources);
    return result;
  };
  const tools = {
    searchProducts: tool({
      description: `Search the Product Library. request values: list = list the products of a brand or category (term is the brand or category name, for example "chairs"); count = how many products a brand or category has (same term); detail = find one product (term is the product name or code). term is plain text only, 80 characters at most, and for list and count it must not contain words like all, list, show, count or which. Read-only. If the request is not covered, do not call this tool; say it is not available.`,
      inputSchema: z.object({ request: z.enum(["list", "count", "detail"]), term: z.string() }),
      execute: async ({ request, term: rawTerm }) => {
        const term = rawTerm.trim();
        const inMessage = request !== "detail"; // list / count keep the term inside the message, so keyword words stay refused there
        if (!PRODUCT_TERM_PATTERN.test(term) || (inMessage && PRODUCT_TERM_TRIGGERS.test(term))) return refuse(inMessage
          ? "The product term is not valid. Use only a brand or category name (letters, digits, spaces, basic punctuation, 80 characters at most) without words like all, list or count."
          : "The product name is not valid. Use letters, digits, spaces and basic punctuation, 80 characters at most.");
        const message = request === "detail" ? PRODUCT_DETAIL_MESSAGE : PRODUCT_MESSAGES[request](term);
        debugToolCall("searchProducts", request, message);
        return collect(await fetchNoaProductCapability(message, context, request === "detail" ? { product: { productText: term } } : undefined));
      },
    }),
    getProductPrice: tool({
      description: `Get product price information. request values: single = the price information of one product (term is the product name); status_summary = the price-check status summary of a whole brand or category (term is the brand or category name). Price lists for a whole category are not available; ask for one product. term is plain text only, 80 characters at most, and for status_summary it must not contain words like all, list, show, count or which. Read-only. If the request is not covered, do not call this tool; say it is not available.`,
      inputSchema: z.object({ request: z.enum(["single", "status_summary"]), term: z.string() }),
      execute: async ({ request, term: rawTerm }) => {
        const term = rawTerm.trim();
        const inMessage = request !== "single";
        if (!PRODUCT_TERM_PATTERN.test(term) || (inMessage && PRODUCT_TERM_TRIGGERS.test(term))) return refuse(inMessage
          ? "The product term is not valid. Use only a brand or category name (letters, digits, spaces, basic punctuation, 80 characters at most) without words like all, list or count."
          : "The product name is not valid. Use letters, digits, spaces and basic punctuation, 80 characters at most.");
        const message = request === "single" ? PRICE_SINGLE_MESSAGE : PRICE_MESSAGES[request](term);
        debugToolCall("getProductPrice", request, message);
        return collect(await fetchNoaPriceCapability(message, context, request === "single" ? { product: { productText: term } } : undefined));
      },
    }),
    searchQuotations: tool({
      description: "Search or summarise quotations (client, status, totals). Read-only.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => validText(query, 200) ? collect(await fetchNoaQuotationCapability(query, context)) : refuse(INVALID_TEXT),
    }),
    getQuotation: tool({
      description: "Get one quotation by its quotation number. Read-only.",
      inputSchema: z.object({ quotationNumber: z.string() }),
      execute: async ({ quotationNumber }) => validText(quotationNumber, 100) ? collect(await fetchNoaQuotationCapability(quotationNumber, context)) : refuse(INVALID_TEXT),
    }),
    getAttentionItems: tool({
      description: "Get the items that need the current user's attention. Read-only.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => validText(query, 200) ? collect(await fetchNoaAttentionCapability(query, context)) : refuse(INVALID_TEXT),
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
    getClientInfo: tool({
      description: `Get client information. report values: list = the active clients; count = how many clients there are; detail = one client's details (needs clientName); projects = the project files of one client (needs clientName). clientName is a company name only (letters, digits, spaces and basic punctuation, 80 characters at most). Read-only. If the request is not covered, do not call this tool; say it is not available.`,
      inputSchema: z.object({ report: z.enum(CLIENT_REPORTS), clientName: z.string().optional() }),
      execute: async ({ report, clientName: rawName }) => {
        const clientName = rawName?.trim();
        if ((report === "detail" || report === "projects") !== (clientName !== undefined) || (clientName !== undefined && !CLIENT_NAME_PATTERN.test(clientName))) {
          return refuse("The client name is missing, not allowed for this report, or not valid. Use a company name with letters, digits, spaces and basic punctuation, 80 characters at most.");
        }
        // "detail" is classified as a project question when the name itself contains the word project(s); refuse instead of answering the wrong question.
        if (report === "detail" && /\bprojects?\b/i.test(clientName ?? "")) return { ok: false as const, message: "I can't look up that client name safely. Try the client number or open the client page.", reason: "ambiguous" as const };
        const message = report === "list" ? "list clients" : report === "count" ? "how many clients are there" : report === "detail" ? `client details for ${clientName}` : `projects for client ${clientName}`;
        return collect(await fetchNoaClientCapability(message, context));
      },
    }),
    getProjectInfo: tool({
      description: `Get project files (ERP Project Files). report values: active_list / completed_list = the active or completed project files; active_count / completed_count = how many; detail = one project file (needs projectFileNumber like CO-1234-56). Read-only. If the request is not covered, do not call this tool; say it is not available.`,
      inputSchema: z.object({ report: z.enum(PROJECT_REPORTS), projectFileNumber: z.string().optional() }),
      execute: async ({ report, projectFileNumber: rawNumber }) => {
        const projectFileNumber = rawNumber?.trim();
        if ((report === "detail") !== (projectFileNumber !== undefined) || (projectFileNumber !== undefined && !PROJECT_FILE_NUMBER_PATTERN.test(projectFileNumber))) {
          return refuse("The project file number is missing, not allowed for this report, or not valid. Use a number like CO-1234-56.");
        }
        return collect(await fetchNoaProjectCapability(report === "detail" ? `project details for ${projectFileNumber}` : PROJECT_MESSAGES[report], context));
      },
    }),
    getProcurementInfo: tool({
      description: `Get procurement orders (needs a procurement role). report values: active_list / completed_list = the active or completed procurement orders; active_count / completed_count = how many; order_detail = one order (needs orderNumber). Read-only. If the request is not covered, do not call this tool; say it is not available.`,
      inputSchema: z.object({ report: z.enum(PROCUREMENT_REPORTS), orderNumber: z.string().optional() }),
      execute: async ({ report, orderNumber: rawNumber }) => {
        const orderNumber = rawNumber?.trim();
        if ((report === "order_detail") !== (orderNumber !== undefined) || (orderNumber !== undefined && !PROCUREMENT_ORDER_NUMBER_PATTERN.test(orderNumber))) {
          return refuse("The order number is missing, not allowed for this report, or not valid. Use an order number like PW-2024-001.");
        }
        return collect(await fetchNoaProcurementCapability(report === "order_detail" ? `order details for ${orderNumber}` : PROCUREMENT_MESSAGES[report], context));
      },
    }),
  };
  return { tools, sources };
}
