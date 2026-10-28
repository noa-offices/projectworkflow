import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, hasToolCall, stepCountIs } from "ai";
import { resolveAiAgentRuntimeConfig, type AiAgentRuntimeConfig } from "@/lib/ai/resolve-agent-runtime-config.server";
import { NoaProviderError } from "@/lib/noa/noa-provider.server";
import { withNoaSpokenResponse } from "@/lib/noa/noa-spoken-response";
import type { NoaAnswer, NoaChatRequest } from "@/lib/noa/noa-types";
import { createNoaAgentTools } from "./noa-agent-tools.server";
import { plainChatText } from "./noa-plain-text";

const DEFAULT_MODEL = "claude-sonnet-5-5";

// Rules copied from SYSTEM_INSTRUCTIONS in noa-provider.server.ts (that file is unchanged), adapted to tool use.
const SYSTEM_PROMPT = `You are NOA, the ProjectWorkflow assistant.
Answer only ProjectWorkflow-related questions, using only data returned by your tools.
Never invent product, quotation, or price facts beyond what the tools return.
If the tools do not contain the answer, say so plainly instead of guessing.
Never infer a product category or type (such as chair, desk, or sofa) from a product name, page context, or earlier messages; mention one only when it is explicitly present in tool data.
Do not imply additional matching records, availability, or follow-up actions unless the tool data establishes them.
Use earlier messages only for conversational context and referent resolution. Do not reuse business facts, counts, prices, durations, statuses, timestamps, entity data, or classifications from earlier messages unless the same facts are also present in the current tool data.
You are strictly read-only: never claim that a write, update, delete, archive, or approval action was performed.
Never give instructions for bypassing permissions or authorization.
Keep answers concise and operational, written for a ProjectWorkflow user, not a developer.
Write plain text only. Never use markdown marks such as ** or # or backticks. For lists use a dash at the start of the line.
When relevant, state plainly whether a fact is the current live value or a saved historical quotation snapshot - never present a quotation's saved snapshot price as the current live product price.
Write in a natural, friendly, conversational tone rather than a formal or system-like one - e.g. prefer "I found 3 chair templates" over "There are 3 chair product templates checked". If the user's display name is provided, you may use it occasionally for a personal touch, but never on every reply and never at the start of routine factual answers. Avoid filler phrases like "Great question!" and avoid emoji outside of a greeting. A short, natural follow-up question is fine when it helps, but never add it just to fill space.
Always use tools to get business facts. If a tool returns not_found, try once more with a simpler or different search before saying you could not find it. Never answer business facts from memory. You are read-only.
Keep answers short: 1 to 3 sentences unless the user asks for detail. No marketing tone. Do not end every answer with an offer to help.
Only state what a tool result actually covers. If the result says it checked 'your' activity, do not say 'no one' or 'the team'. Describe the scope exactly as the result describes it.
Never calculate, sum, convert or estimate numbers yourself. Only repeat numbers and currencies exactly as they appear in a tool result.
For greetings and small talk, reply briefly and do not use any tool.
If a tool says the user is not authorized or has no access, tell the user plainly that they do not have access to that information. Do not try other tools to get around it.
When the user asks for the price of a specific product, or wants to configure a product, use configureProduct. Products are configurable, so there is usually no single price. Use getProductPrice only for price-check status questions. Never guess or calculate a price yourself.`;

type V2Provider = "openai" | "anthropic";

// OpenAI uses the same key variables as lib/ai/providers/openai.server.ts.
const v2ApiKey = (provider: V2Provider) => provider === "openai"
  ? process.env.OPENAI_API_KEY?.trim() || process.env.SOURCE_QA_AI_API_KEY?.trim()
  : process.env.ANTHROPIC_API_KEY?.trim();

// Follows Settings -> AI "NOA Assistant" (the same resolver the old NOA uses). A provider v2 has no SDK for, or a resolver error, falls back to
// NOA_V2_PROVIDER / NOA_V2_MODEL (anthropic unless "openai"). A supported provider without a key never falls back to another provider.
async function resolveV2Model(): Promise<{ provider: V2Provider; apiKey: string; model: string }> {
  let runtime: AiAgentRuntimeConfig | null = null;
  try {
    runtime = await resolveAiAgentRuntimeConfig("noa_orchestrator");
  } catch {
    console.warn("[NOA_V2_PROVIDER_FALLBACK] resolver_error");
  }
  if (runtime && !runtime.enabled) throw new NoaProviderError("NOA is currently disabled by the system administrator.", "not_configured");
  if (runtime && (runtime.provider === "openai" || runtime.provider === "anthropic")) {
    const apiKey = v2ApiKey(runtime.provider);
    if (!runtime.apiKeyConfigured || !apiKey) throw new NoaProviderError("NOA is not configured.", "not_configured");
    return { provider: runtime.provider, apiKey, model: runtime.model };
  }
  if (runtime) console.warn(`[NOA_V2_PROVIDER_FALLBACK] ${runtime.provider}`);
  // NOA_V2_PROVIDER: "openai" or "anthropic"; anything else or missing means anthropic.
  const provider: V2Provider = process.env.NOA_V2_PROVIDER?.trim() === "openai" ? "openai" : "anthropic";
  const apiKey = v2ApiKey(provider);
  if (!apiKey) throw new NoaProviderError("NOA is not configured.", "not_configured");
  const configuredModel = process.env.NOA_V2_MODEL?.trim();
  if (provider === "openai" && !configuredModel) throw new NoaProviderError("NOA v2 model is not set.", "not_configured");
  return { provider, apiKey, model: configuredModel || DEFAULT_MODEL };
}

/** Experimental NOA v2: a read-only tool-calling loop. Authorization stays inside the existing capabilities. */
export async function runNoaAgentLoop(request: NoaChatRequest): Promise<NoaAnswer> {
  const { provider, apiKey, model } = await resolveV2Model();
  const { tools, sources, getConfigurationAnswer } = createNoaAgentTools(request.context, { displayName: request.displayName });
  const page = `Current page: pathname=${request.context.pathname}, section=${request.context.section}. If the user asks where they are, which page this is, or what they are looking at, answer from this. It is about the ProjectWorkflow page, never about physical location.`;
  const system = `${SYSTEM_PROMPT}\n${page}${request.displayName ? `\nThe user's display name is ${request.displayName}.\nWhen you list recorded activity (own or team), always write the person's name. For the signed-in user write their display name followed by (you), for example: ${request.displayName} (you) created quotation QN-0006-001. Never write only 'you' for the signed-in user in activity lists. For other people write just their name.` : ""}`;
  try {
    const generated = await generateText({
      model: provider === "openai" ? createOpenAI({ apiKey })(model) : createAnthropic({ apiKey })(model),
      system,
      messages: [
        ...(request.recentMessages ?? []).map((m) => ({ role: m.role, content: m.text })),
        { role: "user" as const, content: request.message },
      ],
      tools,
      stopWhen: [stepCountIs(5), hasToolCall("configureProduct")],
    });
    const configuration = getConfigurationAnswer();
    if (configuration) return withNoaSpokenResponse({ ...configuration, engine: "v2" }); // the guided flow answer is returned as is, never rewritten by the model
    const result = { text: plainChatText(generated.text) };
    return withNoaSpokenResponse({ domain: "Help", engine: "v2", sources, text: result.text });
  } catch (error) {
    // Debug aid only: safe error fields (never the key, headers, request body, prompt, user message or tool results), key value redacted.
    const clean = (value: unknown, max = 300) => typeof value === "string" ? value.split(apiKey).join("[redacted]").slice(0, max) : undefined;
    const details = (value: unknown) => (typeof value === "object" && value !== null ? value as { name?: unknown; message?: unknown; statusCode?: unknown; responseBody?: unknown; cause?: unknown } : {});
    const failure = details(error);
    const cause = details(failure.cause);
    console.error("[NOA_V2_PROVIDER_ERROR]", JSON.stringify({
      name: clean(failure.name), message: clean(failure.message), statusCode: typeof failure.statusCode === "number" ? failure.statusCode : undefined,
      responseBody: clean(failure.responseBody, 800), cause: failure.cause ? { name: clean(cause.name), message: clean(cause.message) } : undefined,
    }));
    throw new NoaProviderError("NOA could not complete that request.");
  }
}
