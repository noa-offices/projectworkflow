import "server-only";

import { runOpenAiProvider } from "./providers/openai.server";
import { runAnthropicProvider } from "./providers/anthropic.server";
import { runGeminiProvider } from "./providers/gemini.server";
import { AiProviderError, type AiProviderId, type AiProviderRequest, type AiProviderResponse } from "./types";

export type RunAiProviderInput = AiProviderRequest & { provider: AiProviderId };

// The ONE infrastructure entry point every agent's provider call goes through. Agents/capabilities
// never import lib/ai/providers/*.server.ts directly - only this router does, so adding a
// provider later (Anthropic, Gemini) never requires touching an agent's call site. This file only
// ever receives an already-built AiProviderRequest (model, instructions, schema, already-
// authorized userContent) - it has no access to Supabase, no query capability, and no
// service-role credential of any kind; it is execution infrastructure only, never a data path.
export async function runAiProvider({ provider, ...request }: RunAiProviderInput): Promise<AiProviderResponse> {
  if (provider === "openai") {
    return runOpenAiProvider(request);
  }
  if (provider === "anthropic") return runAnthropicProvider(request);
  if (provider === "gemini") return runGeminiProvider(request);

  throw new AiProviderError(`Unsupported AI provider: ${provider}`, "not_configured");
}
