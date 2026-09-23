import type { AiProviderConfig, AiProviderId } from "./types";

export const OPENAI_RESPONSES_API_ENDPOINT = "https://api.openai.com/v1/responses";
export const ANTHROPIC_MESSAGES_API_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const GEMINI_GENERATE_CONTENT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const providers: readonly Readonly<AiProviderConfig>[] = Object.freeze([
  Object.freeze({ id: "openai", label: "OpenAI", endpoint: OPENAI_RESPONSES_API_ENDPOINT }),
  Object.freeze({ id: "anthropic", label: "Anthropic", endpoint: ANTHROPIC_MESSAGES_API_ENDPOINT }),
  Object.freeze({ id: "gemini", label: "Google Gemini", endpoint: GEMINI_GENERATE_CONTENT_ENDPOINT }),
]);

const APPROVED_MODELS: Readonly<Record<AiProviderId, readonly string[]>> = {
  // Kept explicit: system settings never accept arbitrary model identifiers.
  openai: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-4.1", "gpt-4.1-mini"],
  anthropic: ["claude-sonnet-4-6"],
  gemini: ["gemini-2.5-flash-lite"],
};

export function listAiProviderConfigs(): readonly Readonly<AiProviderConfig>[] {
  return providers;
}

export function getAiProviderConfig(id: string): Readonly<AiProviderConfig> | undefined {
  return providers.find((provider) => provider.id === id);
}

export function listApprovedAiModels(providerId: AiProviderId): readonly string[] {
  return APPROVED_MODELS[providerId];
}

export function isApprovedAiModel(providerId: AiProviderId, model: string): boolean {
  return listApprovedAiModels(providerId).includes(model);
}
