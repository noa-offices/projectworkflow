export type AiAgentId =
  | "source_qa"
  | "specification_enrichment"
  | "final_specification"
  | "noa_orchestrator";

export type AiProviderId = "openai" | "anthropic" | "gemini";

export type AiAgentMode =
  | "read_only"
  | "suggestion";

export type AiAgentCapability =
  | "read_pdf"
  | "read_json"
  | "read_reviewed_draft"
  | "read_json_fragment"
  | "read_builder_selection"
  | "suggest_findings"
  | "suggest_text"
  | "product_read"
  | "quotation_read"
  | "price_read"
  | "help";

export type AiAgentConfig = {
  id: AiAgentId;
  label: string;
  enabled: boolean;
  provider: AiProviderId;
  mode: AiAgentMode;
  capabilities: readonly AiAgentCapability[];
  canWrite: boolean;
  modelEnv: string | null;
  defaultModel: string;
};

export type AiProviderConfig = {
  id: AiProviderId;
  label: string;
  endpoint: string;
};

export type AiRuntimeConfigSource = {
  model: "agent_override" | "provider_default" | "env_override" | "registry_default";
  provider: "agent_override" | "global_default" | "registry_default";
};

export type AiProviderContentPart =
  | { type: "text"; text: string }
  | { type: "file"; mimeType: string; data: string; filename?: string };

// Shared, provider-independent request/response contract every agent's provider call goes
// through (lib/ai/provider-router.server.ts). One request shape per call - no streaming, no tool
// calling, structured JSON-schema output always required (never weakened to free-text parsing).
export type AiProviderRequest = {
  content?: AiProviderContentPart[];
  model: string;
  responseSchema: {
    name: string;
    schema: object;
  };
  systemInstructions: string;
  timeoutMs?: number;
  userContent?: unknown;
};

export type AiProviderResponse = {
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

export type AiProviderErrorKind = "not_configured" | "provider_failed" | "timeout";

// Kept here (not in lib/ai/provider-router.server.ts) so both the router and every provider
// adapter (lib/ai/providers/*.server.ts) can import it without a circular dependency between
// those two runtime files.
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: AiProviderErrorKind = "provider_failed",
  ) {
    super(message);
  }
}
