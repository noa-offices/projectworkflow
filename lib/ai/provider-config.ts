import type { AiProviderConfig } from "./types";

export const OPENAI_RESPONSES_API_ENDPOINT = "https://api.openai.com/v1/responses";

const providers: readonly Readonly<AiProviderConfig>[] = Object.freeze([
  Object.freeze({ id: "openai", label: "OpenAI", endpoint: OPENAI_RESPONSES_API_ENDPOINT }),
]);

export function listAiProviderConfigs(): readonly Readonly<AiProviderConfig>[] {
  return providers;
}

export function getAiProviderConfig(id: string): Readonly<AiProviderConfig> | undefined {
  return providers.find((provider) => provider.id === id);
}
