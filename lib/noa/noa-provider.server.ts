import "server-only";

import { runAiProvider } from "@/lib/ai/provider-router.server";
import { resolveAiAgentRuntimeConfig } from "@/lib/ai/resolve-agent-runtime-config.server";
import { AiProviderError } from "@/lib/ai/types";
import type { NoaDomain, NoaPageContext } from "@/lib/noa/noa-types";

const TIMEOUT_MS = 30_000;

// NOA-facing error type preserved exactly (class name, constructor signature, `.kind` values
// route.ts already checks) so app/api/noa/chat/route.ts needs no change: it still does
// `error instanceof NoaProviderError` and `error.kind === "not_configured"`.
export class NoaProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: "not_configured" | "provider_failed" = "provider_failed",
  ) {
    super(message);
  }
}

// Domain and sources are never asked of the model - they're already deterministically known
// (classified by lib/noa/noa-intent-router.ts, fetched by the domain capability) before the
// provider is ever called, so the model can't invent or relabel them. The provider's only job is
// to phrase `text` from the already-fetched, already-authorized capabilityData.
const SYSTEM_INSTRUCTIONS = `You are NOA, the ProjectWorkflow assistant.
Answer only ProjectWorkflow-related questions, using only the supplied internal capability data.
Never invent product, quotation, or price facts beyond what is supplied in capabilityData.
If capabilityData does not contain the answer, say so plainly instead of guessing.
You are strictly read-only: never claim that a write, update, delete, archive, or approval action was performed.
Never give instructions for bypassing permissions or authorization.
Keep answers concise and operational, written for a ProjectWorkflow user, not a developer.
When relevant, state plainly whether a fact is the current live value or a saved historical quotation snapshot - never present a quotation's saved snapshot price as the current live product price.
Write in a natural, friendly, conversational tone rather than a formal or system-like one - e.g. prefer "I found 3 chair templates" over "There are 3 chair product templates checked". If userDisplayName is provided, you may use it occasionally for a personal touch, but never on every reply and never at the start of routine factual answers - most answers should not mention the user's name at all. Avoid filler phrases like "Great question!" and avoid emoji outside of a greeting. A short, natural follow-up question is fine when it helps ("Want me to show them?"), but never add it just to fill space.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: { type: "string", maxLength: 1200 },
  },
} as const;

export type NoaProviderRequest = {
  capabilityData: unknown;
  context: NoaPageContext;
  displayName?: string;
  domain: NoaDomain;
  message: string;
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>;
};

// Maps the shared, provider-independent AiProviderError onto NOA's own error type/messages -
// same messages/kinds NOA already threw before this migration, just now sourced from whichever
// provider adapter actually ran (only OpenAI today).
function toNoaProviderError(error: AiProviderError): NoaProviderError {
  if (error.kind === "not_configured") {
    return new NoaProviderError("NOA is not configured.", "not_configured");
  }
  if (error.kind === "timeout") {
    return new NoaProviderError("NOA request timed out.");
  }
  return new NoaProviderError("NOA could not complete that request.");
}

export async function runNoaProvider(request: NoaProviderRequest): Promise<{ text: string }> {
  const runtime = await resolveAiAgentRuntimeConfig("noa_orchestrator");

  if (!runtime.enabled) {
    throw new NoaProviderError("NOA is currently disabled by the system administrator.", "not_configured");
  }

  if (!runtime.apiKeyConfigured) {
    throw new NoaProviderError("NOA is not configured.", "not_configured");
  }

  try {
    const response = await runAiProvider({
      model: runtime.model,
      provider: runtime.provider,
      responseSchema: { name: "noa_answer_text", schema },
      systemInstructions: SYSTEM_INSTRUCTIONS,
      timeoutMs: TIMEOUT_MS,
      userContent: {
        capabilityData: request.capabilityData,
        domain: request.domain,
        pageContext: request.context,
        question: request.message,
        recentMessages: request.recentMessages,
        userDisplayName: request.displayName ?? null,
      },
    });

    const parsed = response.text ? (JSON.parse(response.text) as { text?: unknown }) : null;

    if (!parsed || typeof parsed.text !== "string" || !parsed.text.trim()) {
      throw new NoaProviderError("NOA returned an invalid result.");
    }

    return { text: parsed.text };
  } catch (error) {
    if (error instanceof NoaProviderError) throw error;
    if (error instanceof AiProviderError) throw toNoaProviderError(error);
    throw new NoaProviderError("NOA could not complete that request.");
  }
}
